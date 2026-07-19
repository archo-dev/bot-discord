import type { MiddlewareHandler } from "hono";
import { canManageGuild, isPanelMutationAllowed, matchPanelMutationPolicy } from "@bot/shared";
import type { Env } from "../env.js";
import { discordJson, isGuildAccessLost } from "../discord/rest.js";
import { getGuild, listPanelAccess, setBotInstalled } from "../db/queries.js";
import { loadSession, readSessionCookie, type SessionData } from "./session.js";
import type { TelemetryVariables } from "../telemetry/request.js";

export interface OAuthGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

/**
 * manage_guild     — MANAGE_GUILD/ADMINISTRATOR on Discord: full access.
 * panel_admin      — explicit grant with level 'admin': full access.
 * panel_moderator  — explicit grant with level 'moderator': read-only
 *                    (every write verb under the guild is rejected with 403).
 */
export type GuildAccess = "manage_guild" | "panel_admin" | "panel_moderator";

export interface AppVariables extends TelemetryVariables {
  session: SessionData & { id: string };
  guildAccess: GuildAccess;
}

export type AppContext = { Bindings: Env; Variables: AppVariables };

/** Loads the KV session or fails with 401. */
export const requireSession: MiddlewareHandler<AppContext> = async (c, next) => {
  const sid = readSessionCookie(c);
  const loaded = sid ? await loadSession(c.env, sid) : { session: null, reason: "missing" as const };
  const session = loaded.session;
  if (!sid || !session) return c.json({ error: loaded.reason === "revoked" ? "session_revoked" : loaded.reason === "expired" ? "session_expired" : "unauthenticated" }, 401);
  c.set("session", { ...session, id: sid });
  await next();
};

/**
 * The user's guild list as Discord reports it (OAuth `guilds` scope),
 * KV-cached for 60s. Returns null when the user token was revoked.
 */
export async function getUserGuilds(
  env: Env,
  session: SessionData & { id: string },
  options: { allowRecentOnTransientError?: boolean } = {},
): Promise<OAuthGuild[] | null> {
  const cacheKey = `guilds:${session.userId}`;
  const recentKey = `guilds:recent:${session.userId}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return JSON.parse(cached) as OAuthGuild[];

  const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    if (options.allowRecentOnTransientError && (res.status === 429 || res.status >= 500)) {
      const recent = await env.KV.get(recentKey);
      if (recent) return JSON.parse(recent) as OAuthGuild[];
    }
    throw new Error(`users/@me/guilds failed: ${res.status}`);
  }
  const guilds = (await res.json()) as OAuthGuild[];
  const serialized = JSON.stringify(guilds);
  await Promise.all([
    env.KV.put(cacheKey, serialized, { expirationTtl: 60 }),
    env.KV.put(recentKey, serialized, { expirationTtl: 180 }),
  ]);
  return guilds;
}

interface RESTMember {
  user?: { id: string; username: string; global_name: string | null; avatar: string | null };
  roles: string[];
  joined_at?: string;
}

/** The member subset we cache — enough for the access guard AND member cards (M20). */
export interface CachedMember {
  roles: string[];
  user: { id: string; username: string; globalName: string | null; avatar: string | null } | null;
  joinedAt: string | null;
}

/**
 * A guild member via bot REST, KV-cached 60s. null = not a member (or lookup
 * failed). Shared by the access guard (roles) and member cards (M20); the
 * `v2` key avoids reading the pre-M20 `{roles}` shape after a deploy.
 */
export async function getMember(env: Env, guildId: string, userId: string): Promise<CachedMember | null> {
  const cacheKey = `member:v2:${guildId}:${userId}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return (JSON.parse(cached) as { member: CachedMember | null }).member;

  let member: CachedMember | null = null;
  try {
    const m = await discordJson<RESTMember>(env, "GET", `/guilds/${guildId}/members/${userId}`);
    member = {
      roles: m.roles,
      user: m.user
        ? { id: m.user.id, username: m.user.username, globalName: m.user.global_name, avatar: m.user.avatar }
        : null,
      joinedAt: m.joined_at ?? null,
    };
  } catch {
    member = null;
  }
  await env.KV.put(cacheKey, JSON.stringify({ member }), { expirationTtl: 60 });
  return member;
}

/** Member roles via bot REST, KV-cached 60s. null = not a member (or lookup failed). */
async function getMemberRoles(env: Env, guildId: string, userId: string): Promise<string[] | null> {
  return (await getMember(env, guildId, userId))?.roles ?? null;
}

/**
 * SECURITY CORE — re-verifies the user's REAL Discord permissions on every
 * panel API request (never trusts the client):
 *  1. MANAGE_GUILD or ADMINISTRATOR on this guild (per Discord OAuth) → allow
 *  2. else an explicit panel_access grant (direct user, or role checked via
 *     bot REST member lookup) → allow
 *  3. otherwise 403. Guilds without the bot installed are 404.
 */
export const requireGuildAccess: MiddlewareHandler<AppContext> = async (c, next) => {
  const guildId = c.req.param("guildId");
  if (!guildId || !/^\d{5,20}$/.test(guildId)) return c.json({ error: "invalid_guild_id" }, 400);

  const session = c.get("session");

  const guildRow = await getGuild(c.env.DB, guildId);
  if (!guildRow || guildRow.bot_installed !== 1) return c.json({ error: "bot_not_installed" }, 404);

  const musicStateRead = c.req.method === "GET" &&
    new URL(c.req.url).pathname === `/api/guilds/${guildId}/music-state`;
  const userGuilds = await getUserGuilds(c.env, session, {
    allowRecentOnTransientError: musicStateRead,
  });
  if (userGuilds === null) return c.json({ error: "session_expired" }, 401);

  const oauthGuild = userGuilds.find((g) => g.id === guildId);
  // Discord can report an owner with a bitfield without MANAGE_GUILD.
  if (oauthGuild && (oauthGuild.owner || canManageGuild(oauthGuild.permissions))) {
    c.set("guildAccess", "manage_guild");
    await next();
    return;
  }

  const grants = await listPanelAccess(c.env.DB, guildId);
  const matched = grants.filter((g) => g.subject_type === "user" && g.subject_id === session.userId);
  const roleGrants = grants.filter((g) => g.subject_type === "role");
  // Only resolve member roles when a role grant could still raise the level.
  if (roleGrants.length > 0 && !matched.some((g) => g.level === "admin")) {
    const roles = await getMemberRoles(c.env, guildId, session.userId);
    if (roles) matched.push(...roleGrants.filter((g) => roles.includes(g.subject_id)));
  }
  if (matched.length > 0) {
    // A user matched by several grants gets the highest level.
    c.set("guildAccess", matched.some((g) => g.level === "admin") ? "panel_admin" : "panel_moderator");
    await next();
    return;
  }

  return c.json({ error: "forbidden" }, 403);
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Read-only enforcement for moderator grants: rejects every write verb under
 * a guild with 403. Mounted centrally in index.ts so new write routes are
 * born protected — route-level checks must never be the only barrier.
 */
export const enforcePanelMutationPolicy: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!WRITE_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  const policy = matchPanelMutationPolicy(c.req.method, new URL(c.req.url).pathname);
  if (!policy) return c.json({ error: "security_policy_missing" }, 403);
  const access = c.get("guildAccess");
  if (!isPanelMutationAllowed(policy, access)) {
    return c.json({ error: access === "panel_moderator" ? "read_only_access" : "forbidden" }, 403);
  }
  await next();
};

/** Only members with MANAGE_GUILD may pass (panel-access management, etc.). */
export const requireManageGuild: MiddlewareHandler<AppContext> = async (c, next) => {
  if (c.get("guildAccess") !== "manage_guild") return c.json({ error: "forbidden" }, 403);
  await next();
};

/** Flip bot_installed off when a bot REST call reveals we lost the guild. */
export async function handleGuildAccessLoss(env: Env, guildId: string, err: unknown): Promise<boolean> {
  if (isGuildAccessLost(err)) {
    await setBotInstalled(env.DB, guildId, false);
    return true;
  }
  return false;
}
