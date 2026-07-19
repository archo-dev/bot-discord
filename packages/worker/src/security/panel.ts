import type { MiddlewareHandler } from "hono";
import { matchPanelMutationPolicy } from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import { consumeDurableQuota, insertAdminAudit, type DurableQuotaCapability } from "../db/queries.js";
import { securityPseudonym } from "./pseudonym.js";

const COSTLY: ReadonlyArray<{
  method: string;
  pattern: RegExp;
  capability: DurableQuotaCapability;
  userLimit: number;
  guildLimit: number;
  /** Separates counters without adding a new D1 capability/schema value. */
  namespace?: string;
}> = [
  { method: "PATCH", pattern: /^\/api\/guilds\/\d{5,20}\/nickname$/, capability: "guild_identity", userLimit: 10, guildLimit: 50 },
  { method: "POST", pattern: /^\/api\/guilds\/\d{5,20}\/(button-roles|tickets\/panel)$/, capability: "discord_publish", userLimit: 10, guildLimit: 100 },
  { method: "POST", pattern: /^\/api\/guilds\/\d{5,20}\/music-(control|enqueue)$/, capability: "music_control", userLimit: 300, guildLimit: 2_000 },
  { method: "POST", pattern: /^\/api\/guilds\/\d{5,20}\/music-search$/, capability: "music_control", userLimit: 300, guildLimit: 2_000, namespace: "music-search" },
];

export function durableQuotaNamespace(method: string, pathname: string): string | null {
  const rule = COSTLY.find((candidate) => candidate.method === method && candidate.pattern.test(pathname));
  return rule ? (rule.namespace ?? rule.capability) : null;
}

function target(pathname: string): { type: "command" | "warning" | "button_role" | null; id: string | null } {
  const command = pathname.match(/\/commands\/(\d+)(?:\/state)?$/);
  if (command) return { type: "command", id: command[1]! };
  const warning = pathname.match(/\/warnings\/(\d+)$/);
  if (warning) return { type: "warning", id: warning[1]! };
  const button = pathname.match(/\/button-roles\/(\d+)$/);
  if (button) return { type: "button_role", id: button[1]! };
  return { type: null, id: null };
}

export const durablePanelQuota: MiddlewareHandler<AppContext> = async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  const rule = COSTLY.find((candidate) => candidate.method === c.req.method && candidate.pattern.test(pathname));
  if (!rule) {
    await next();
    return;
  }
  const guildId = c.req.param("guildId")!;
  const actorId = c.get("session").userId;
  const purposeSuffix = rule.namespace ? `:${rule.namespace}` : "";
  const [guildKey, guildScopeKey, userScopeKey] = await Promise.all([
    securityPseudonym(c.env.SESSION_SECRET, `quota-guild${purposeSuffix}`, guildId, guildId),
    securityPseudonym(c.env.SESSION_SECRET, `quota-scope${purposeSuffix}`, guildId, "guild"),
    securityPseudonym(c.env.SESSION_SECRET, `quota-user${purposeSuffix}`, guildId, actorId),
  ]);
  const allowed = await consumeDurableQuota(c.env.DB, {
    day: new Date().toISOString().slice(0, 10), guildKey, guildScopeKey, userScopeKey,
    capability: rule.capability, guildLimit: rule.guildLimit, userLimit: rule.userLimit,
  });
  if (!allowed) return c.json({ error: "quota_exceeded", retryAfterSeconds: 86_400 }, 429);
  await next();
};

export const adminAudit: MiddlewareHandler<AppContext> = async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  const policy = matchPanelMutationPolicy(c.req.method, pathname);
  if (!policy) {
    await next();
    return;
  }
  await next();
  const status = c.res.status;
  const resource = target(pathname);
  c.executionCtx.waitUntil(insertAdminAudit(c.env.DB, {
    guildId: c.req.param("guildId")!,
    actorId: c.get("session").userId,
    actorAccess: c.get("guildAccess"),
    capability: policy.capability,
    method: policy.method,
    targetType: resource.type,
    targetId: resource.id,
    outcome: status < 400 ? "success" : "error",
    status,
    requestId: c.get("requestId"),
  }).catch(() => undefined));
};
