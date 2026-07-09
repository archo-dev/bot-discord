import type { MiddlewareHandler } from "hono";
import { canManageGuild } from "@bot/shared";
import type { Env } from "../env.js";
import { discordJson, isGuildAccessLost } from "../discord/rest.js";
import { getGuild, listPanelAccess, setBotInstalled } from "../db/queries.js";
import { getSession, readSessionCookie, type SessionData } from "./session.js";

export interface OAuthGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

export type GuildAccess = "manage_guild" | "panel_grant";

export interface AppVariables {
  session: SessionData & { id: string };
  guildAccess: GuildAccess;
}

export type AppContext = { Bindings: Env; Variables: AppVariables };

/** Loads the KV session or fails with 401. */
export const requireSession: MiddlewareHandler<AppContext> = async (c, next) => {
  const sid = readSessionCookie(c);
  const session = sid ? await getSession(c.env, sid) : null;
  if (!sid || !session) return c.json({ error: "unauthenticated" }, 401);
  if (session.tokenExpiresAt < Date.now()) {
    return c.json({ error: "session_expired" }, 401);
  }
  c.set("session", { ...session, id: sid });
  await next();
};

/**
 * The user's guild list as Discord reports it (OAuth `guilds` scope),
 * KV-cached for 60s. Returns null when the user token was revoked.
 */
export async function getUserGuilds(env: Env, session: SessionData & { id: string }): Promise<OAuthGuild[] | null> {
  const cacheKey = `guilds:${session.userId}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return JSON.parse(cached) as OAuthGuild[];

  const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`users/@me/guilds failed: ${res.status}`);
  const guilds = (await res.json()) as OAuthGuild[];
  await env.KV.put(cacheKey, JSON.stringify(guilds), { expirationTtl: 60 });
  return guilds;
}

interface RESTMember {
  roles: string[];
}

/** Member roles via bot REST, KV-cached 60s. null = not a member (or lookup failed). */
async function getMemberRoles(env: Env, guildId: string, userId: string): Promise<string[] | null> {
  const cacheKey = `member:${guildId}:${userId}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return (JSON.parse(cached) as { roles: string[] | null }).roles;

  let roles: string[] | null = null;
  try {
    const member = await discordJson<RESTMember>(env, "GET", `/guilds/${guildId}/members/${userId}`);
    roles = member.roles;
  } catch {
    roles = null;
  }
  await env.KV.put(cacheKey, JSON.stringify({ roles }), { expirationTtl: 60 });
  return roles;
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

  const userGuilds = await getUserGuilds(c.env, session);
  if (userGuilds === null) return c.json({ error: "session_expired" }, 401);

  const oauthGuild = userGuilds.find((g) => g.id === guildId);
  if (oauthGuild && canManageGuild(oauthGuild.permissions)) {
    c.set("guildAccess", "manage_guild");
    await next();
    return;
  }

  const grants = await listPanelAccess(c.env.DB, guildId);
  if (grants.some((g) => g.subject_type === "user" && g.subject_id === session.userId)) {
    c.set("guildAccess", "panel_grant");
    await next();
    return;
  }
  const roleGrants = grants.filter((g) => g.subject_type === "role");
  if (roleGrants.length > 0) {
    const roles = await getMemberRoles(c.env, guildId, session.userId);
    if (roles && roleGrants.some((g) => roles.includes(g.subject_id))) {
      c.set("guildAccess", "panel_grant");
      await next();
      return;
    }
  }

  return c.json({ error: "forbidden" }, 403);
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
