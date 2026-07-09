import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import {
  activeWarningCount,
  getAutomodSettings,
  getGuild,
  getLogSettings,
  getWelcomeSettings,
  insertGatewayEvent,
  insertModAction,
  insertWarning,
  listAutoRoles,
  listCustomCommands,
} from "../db/queries.js";
import { logRowToDto, welcomeRowToDto } from "../api/welcome.js";
import { automodRowToDto } from "../api/automod.js";
import { discordJson } from "../discord/rest.js";
import { modLogEmbed, postModLog } from "../interactions/builtins/util.js";

/**
 * Internal API for the future always-on Gateway service (Option B).
 * Bearer-token-guarded from day one so the gateway lands without Worker
 * changes. Contract documented in the README.
 */
export const internalRouter = new Hono<{ Bindings: Env }>();

internalRouter.use("/internal/*", async (c, next) => {
  const auth = c.req.header("authorization");
  if (!auth || auth !== `Bearer ${c.env.INTERNAL_API_TOKEN}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

const heartbeatSchema = z.object({
  guildCount: z.number().int().min(0),
  wsPing: z.number().nullable().optional(),
});

// Posted every 60 s by the gateway; the KV TTL makes a silent gateway read as
// disconnected without any cleanup job (panel badge = key presence).
internalRouter.post("/internal/gateway/heartbeat", async (c) => {
  const parsed = heartbeatSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await c.env.KV.put(
    "gateway:status",
    JSON.stringify({ at: Date.now(), guildCount: parsed.data.guildCount, wsPing: parsed.data.wsPing ?? null }),
    { expirationTtl: 180 },
  );
  return c.json({ ok: true });
});

internalRouter.get("/internal/guilds/:guildId/config", async (c) => {
  const guildId = c.req.param("guildId");
  const guild = await getGuild(c.env.DB, guildId);
  if (!guild) return c.json({ error: "not_found" }, 404);
  const autoRoles = await listAutoRoles(c.env.DB, guildId);
  return c.json({
    id: guild.id,
    logChannelId: guild.log_channel_id,
    warnThreshold: guild.warn_threshold,
    warnTimeoutMinutes: guild.warn_timeout_minutes,
    autoRoles: autoRoles.filter((r) => r.enabled === 1).map((r) => r.role_id),
    welcome: welcomeRowToDto(await getWelcomeSettings(c.env.DB, guildId)),
    logs: logRowToDto(await getLogSettings(c.env.DB, guildId)),
    automod: automodRowToDto(await getAutomodSettings(c.env.DB, guildId)),
  });
});

internalRouter.get("/internal/guilds/:guildId/commands", async (c) => {
  const guildId = c.req.param("guildId");
  const trigger = c.req.query("trigger");
  const rows = await listCustomCommands(c.env.DB, guildId);
  const filtered = rows.filter((r) => r.enabled === 1 && (trigger ? r.trigger_type === trigger : true));
  return c.json(filtered.map((r) => ({ id: r.id, name: r.name, triggerType: r.trigger_type, logic: JSON.parse(r.logic) as unknown })));
});

const eventSchema = z.object({
  eventType: z.enum(["member_join", "member_leave", "automod_action", "keyword_trigger"]),
  payload: z.record(z.string(), z.unknown()),
});

internalRouter.post("/internal/guilds/:guildId/events", async (c) => {
  const parsed = eventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await insertGatewayEvent(c.env.DB, c.req.param("guildId"), parsed.data.eventType, JSON.stringify(parsed.data.payload));
  return c.json({ ok: true }, 201);
});

const RULE_LABELS = { spam: "spam", invite: "invitation Discord", link: "lien", word: "mot interdit" } as const;

const sanctionSchema = z.object({
  userId: z.string().regex(/^\d{5,20}$/),
  rule: z.enum(["spam", "invite", "link", "word"]),
  action: z.enum(["warn", "timeout"]),
});

/**
 * Automod sanction, applied server-side so warnings feed the same
 * warn-threshold → auto-timeout mechanic as /warn (the gateway only detects).
 */
internalRouter.post("/internal/guilds/:guildId/automod-sanctions", async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = sanctionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { userId, rule, action } = parsed.data;
  const reason = `Automod : ${RULE_LABELS[rule]}`;
  const automod = automodRowToDto(await getAutomodSettings(c.env.DB, guildId));

  if (action === "timeout") {
    const until = new Date(Date.now() + automod.timeoutMinutes * 60_000).toISOString();
    await discordJson(
      c.env,
      "PATCH",
      `/guilds/${guildId}/members/${userId}`,
      { communication_disabled_until: until },
      { auditLogReason: reason },
    );
    const caseId = await insertModAction(c.env.DB, {
      guildId,
      action: "timeout",
      targetId: userId,
      moderatorId: "automod",
      reason,
      metadata: { durationMinutes: automod.timeoutMinutes, rule },
      source: "gateway",
    });
    await postModLog(
      c.env,
      guildId,
      modLogEmbed({
        action: "timeout",
        title: "🤖 Timeout (auto-modération)",
        targetId: userId,
        moderatorId: "automod",
        reason,
        caseId,
        extra: [{ name: "Durée", value: `${automod.timeoutMinutes} min` }],
      }),
    );
    return c.json({ ok: true, applied: "timeout" }, 201);
  }

  // action === "warn": same flow as /warn, attributed to 'automod'.
  await insertWarning(c.env.DB, guildId, userId, "automod", reason);
  const caseId = await insertModAction(c.env.DB, {
    guildId,
    action: "warn",
    targetId: userId,
    moderatorId: "automod",
    reason,
    metadata: { rule },
    source: "gateway",
  });
  await postModLog(
    c.env,
    guildId,
    modLogEmbed({ action: "warn", title: "🤖 Avertissement (auto-modération)", targetId: userId, moderatorId: "automod", reason, caseId }),
  );

  const count = await activeWarningCount(c.env.DB, guildId, userId);
  const guild = await getGuild(c.env.DB, guildId);
  const threshold = guild?.warn_threshold ?? 3;
  const timeoutMinutes = guild?.warn_timeout_minutes ?? 60;
  let autoTimeout = false;
  if (count >= threshold) {
    try {
      const until = new Date(Date.now() + timeoutMinutes * 60_000).toISOString();
      await discordJson(
        c.env,
        "PATCH",
        `/guilds/${guildId}/members/${userId}`,
        { communication_disabled_until: until },
        { auditLogReason: `Seuil de ${threshold} avertissements atteint` },
      );
      const autoCaseId = await insertModAction(c.env.DB, {
        guildId,
        action: "auto_timeout",
        targetId: userId,
        moderatorId: "system",
        reason: `Seuil de ${threshold} avertissements atteint`,
        metadata: { durationMinutes: timeoutMinutes, warnCount: count },
        source: "gateway",
      });
      await postModLog(
        c.env,
        guildId,
        modLogEmbed({
          action: "auto_timeout",
          title: "🔇 Timeout automatique (seuil de warns)",
          targetId: userId,
          moderatorId: "automod",
          reason: `${count} avertissements actifs (seuil : ${threshold})`,
          caseId: autoCaseId,
          extra: [{ name: "Durée", value: `${timeoutMinutes} min` }],
        }),
      );
      autoTimeout = true;
    } catch (err) {
      console.error("automod auto-timeout failed:", err);
    }
  }
  return c.json({ ok: true, applied: "warn", warnCount: count, autoTimeout }, 201);
});

const modActionSchema = z.object({
  action: z.enum(["ban", "unban", "kick", "timeout", "auto_timeout", "warn", "unwarn", "clear"]),
  targetId: z.string().regex(/^\d{5,20}$/).nullable(),
  moderatorId: z.string().min(1).max(32),
  reason: z.string().max(512).nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

internalRouter.post("/internal/guilds/:guildId/mod-actions", async (c) => {
  const parsed = modActionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const id = await insertModAction(c.env.DB, {
    guildId: c.req.param("guildId"),
    ...parsed.data,
    source: "gateway",
  });
  return c.json({ ok: true, id }, 201);
});
