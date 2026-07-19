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

/** Distinct membership-lookup outcomes so callers separate 401/429/5xx cleanly. */
export type UserGuildsResult =
  | { status: "ok"; guilds: OAuthGuild[] }
  | { status: "unauthorized" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

type DiscordGuildsFetch =
  | { kind: "ok"; guilds: OAuthGuild[] }
  | { kind: "unauthorized" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "unavailable" };

/**
 * Coalesces concurrent `users/@me/guilds` fetches for the same user within an
 * isolate: a burst of panel polls (music-state + page loads) shares one Discord
 * request instead of each racing to hit — and rate-limit — the endpoint.
 */
const inflightUserGuilds = new Map<string, Promise<DiscordGuildsFetch>>();

/** Retry-After (seconds) clamped to a sane window; reads fall back to `recent`. */
function clampRetryAfter(header: string | null): number {
  const parsed = header != null ? Number(header) : NaN;
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(60, Math.max(1, Math.ceil(parsed)));
}

async function fetchUserGuilds(env: Env, session: SessionData & { id: string }): Promise<DiscordGuildsFetch> {
  const key = session.userId;
  const existing = inflightUserGuilds.get(key);
  if (existing) return existing;

  const run = async (): Promise<DiscordGuildsFetch> => {
    let res: Response;
    try {
      res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
    } catch {
      return { kind: "unavailable" };
    }
    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 429) {
      const retryAfterSeconds = clampRetryAfter(res.headers.get("retry-after"));
      // Remember the backoff so subsequent polls serve `recent` instead of
      // hammering Discord for the whole Retry-After window. The value is the
      // real expiry epoch (Retry-After honoured to the second); the KV TTL only
      // reclaims the key and must respect KV's 60s floor.
      const expiresAt = Date.now() + retryAfterSeconds * 1000;
      await env.KV.put(`guilds:backoff:${session.userId}`, String(expiresAt), {
        expirationTtl: Math.max(60, retryAfterSeconds),
      });
      return { kind: "rate_limited", retryAfterSeconds };
    }
    if (!res.ok) return { kind: "unavailable" };
    let guilds: OAuthGuild[];
    try {
      guilds = (await res.json()) as OAuthGuild[];
    } catch {
      return { kind: "unavailable" };
    }
    const serialized = JSON.stringify(guilds);
    await Promise.all([
      env.KV.put(`guilds:${session.userId}`, serialized, { expirationTtl: 60 }),
      env.KV.put(`guilds:recent:${session.userId}`, serialized, { expirationTtl: 180 }),
    ]);
    return { kind: "ok", guilds };
  };

  const entry = run().finally(() => {
    if (inflightUserGuilds.get(key) === entry) inflightUserGuilds.delete(key);
  });
  inflightUserGuilds.set(key, entry);
  return entry;
}

/**
 * The user's guild list as Discord reports it (OAuth `guilds` scope), KV-cached
 * for 60s. A Discord 429 or 5xx never crashes the request: with `allowRecent`
 * (read-only continuity) the last verified list is served for up to 180s;
 * otherwise the outcome (`unauthorized`/`rate_limited`/`unavailable`) is
 * surfaced for the caller to map to a proper status — never a 500.
 */
export async function getUserGuilds(
  env: Env,
  session: SessionData & { id: string },
  options: { allowRecent?: boolean } = {},
): Promise<UserGuildsResult> {
  const cacheKey = `guilds:${session.userId}`;
  const recentKey = `guilds:recent:${session.userId}`;
  const backoffKey = `guilds:backoff:${session.userId}`;

  const cached = await env.KV.get(cacheKey);
  if (cached) return { status: "ok", guilds: JSON.parse(cached) as OAuthGuild[] };

  const serveRecent = async (): Promise<OAuthGuild[] | null> => {
    if (!options.allowRecent) return null;
    const recent = await env.KV.get(recentKey);
    return recent ? (JSON.parse(recent) as OAuthGuild[]) : null;
  };

  // An active rate-limit backoff is honoured without touching Discord again.
  const backoff = await env.KV.get(backoffKey);
  if (backoff) {
    const expiresAt = Number(backoff);
    const remainingSeconds = Number.isFinite(expiresAt) ? Math.ceil((expiresAt - Date.now()) / 1000) : 0;
    if (remainingSeconds > 0) {
      const recent = await serveRecent();
      if (recent) return { status: "ok", guilds: recent };
      return { status: "rate_limited", retryAfterSeconds: remainingSeconds };
    }
  }

  const fetched = await fetchUserGuilds(env, session);
  switch (fetched.kind) {
    case "ok":
      return { status: "ok", guilds: fetched.guilds };
    case "unauthorized":
      return { status: "unauthorized" };
    case "rate_limited": {
      const recent = await serveRecent();
      if (recent) return { status: "ok", guilds: recent };
      return { status: "rate_limited", retryAfterSeconds: fetched.retryAfterSeconds };
    }
    case "unavailable": {
      const recent = await serveRecent();
      if (recent) return { status: "ok", guilds: recent };
      return { status: "unavailable" };
    }
  }
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

  // Read-only requests keep working from the recently verified guild list when
  // Discord is briefly rate-limited/unavailable; writes always fail closed.
  const result = await getUserGuilds(c.env, session, { allowRecent: c.req.method === "GET" });
  if (result.status === "unauthorized") return c.json({ error: "session_expired" }, 401);
  if (result.status === "rate_limited") {
    c.header("Retry-After", String(result.retryAfterSeconds));
    return c.json({ error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds }, 429);
  }
  if (result.status === "unavailable") return c.json({ error: "discord_unavailable" }, 503);
  const userGuilds = result.guilds;

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
