import { Hono } from "hono";
import type { ResolvedMember } from "@bot/shared";
import { discordJson, discordRequest } from "../discord/rest.js";
import { handleGuildAccessLoss, type AppContext } from "../auth/guard.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const membersRouter = new Hono<AppContext>();

interface RESTUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar: string | null;
  bot?: boolean;
}

interface RESTMember {
  user?: RESTUser;
  nick?: string | null;
  /** Guild-specific avatar hash. */
  avatar?: string | null;
}

const CDN = "https://cdn.discordapp.com";

/** Guild avatar > user avatar > default embed avatar, always a usable URL (size 64). */
function avatarUrl(guildId: string, user: RESTUser, guildAvatar: string | null | undefined): string {
  if (guildAvatar) return `${CDN}/guilds/${guildId}/users/${user.id}/avatars/${guildAvatar}.png?size=64`;
  if (user.avatar) return `${CDN}/avatars/${user.id}/${user.avatar}.png?size=64`;
  // Post-migration usernames: index = (id >> 22) % 6 ; legacy discriminators are gone.
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `${CDN}/embed/avatars/${index}.png`;
}

function toResolved(guildId: string, user: RESTUser, member?: RESTMember): ResolvedMember {
  return {
    id: user.id,
    displayName: member?.nick || user.global_name || user.username,
    username: user.username,
    avatarUrl: avatarUrl(guildId, user, member?.avatar),
    bot: user.bot === true,
    inGuild: member !== undefined,
  };
}

/** Fetch one member (falls back to the global user if they left). Returns null if unresolvable. */
async function resolveOne(c: { env: AppContext["Bindings"] }, guildId: string, userId: string): Promise<ResolvedMember | null> {
  const cacheKey = `member:v1:${guildId}:${userId}`;
  const cached = await c.env.KV.get(cacheKey);
  if (cached) return JSON.parse(cached) as ResolvedMember;

  const memberRes = await discordRequest(c.env, "GET", `/guilds/${guildId}/members/${userId}`);
  let resolved: ResolvedMember | null = null;
  if (memberRes.ok) {
    const member = (await memberRes.json()) as RESTMember;
    if (member.user) resolved = toResolved(guildId, member.user, member);
  } else if (memberRes.status === 404) {
    const userRes = await discordRequest(c.env, "GET", `/users/${userId}`);
    if (userRes.ok) resolved = toResolved(guildId, (await userRes.json()) as RESTUser);
  }
  if (resolved) await c.env.KV.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 600 });
  return resolved;
}

/**
 * Batch-resolve members for the UserCell. `?ids=a,b,c` (max 50 valid snowflakes).
 * Returns only ids that resolved — the panel degrades gracefully for the rest.
 */
membersRouter.get("/guilds/:guildId/members/resolve", async (c) => {
  const guildId = c.req.param("guildId");
  const raw = (c.req.query("ids") ?? "").split(",").map((s) => s.trim());
  const ids = [...new Set(raw.filter((s) => /^\d{5,20}$/.test(s)))].slice(0, 50);
  if (ids.length === 0) return c.json([] as ResolvedMember[]);

  try {
    const results = await Promise.all(ids.map((id) => resolveOne(c, guildId, id)));
    return c.json(results.filter((m): m is ResolvedMember => m !== null));
  } catch (err) {
    if (await handleGuildAccessLoss(c.env, guildId, err)) return c.json({ error: "bot_not_installed" }, 404);
    return c.json({ error: "discord_error" }, 502);
  }
});

/**
 * Search guild members by name for the Combobox. `?q=` (1–32 chars).
 * Requires the GUILD_MEMBERS privileged intent (enabled for this app).
 */
membersRouter.get("/guilds/:guildId/members/search", async (c) => {
  const guildId = c.req.param("guildId");
  const q = (c.req.query("q") ?? "").trim().slice(0, 32);
  if (q.length === 0) return c.json([] as ResolvedMember[]);

  const cacheKey = `msearch:v1:${guildId}:${q.toLowerCase()}`;
  const cached = await c.env.KV.get(cacheKey);
  if (cached) return c.json(JSON.parse(cached) as ResolvedMember[]);

  try {
    const members = await discordJson<RESTMember[]>(
      c.env,
      "GET",
      `/guilds/${guildId}/members/search?query=${encodeURIComponent(q)}&limit=10`,
    );
    const options = members
      .filter((m): m is RESTMember & { user: RESTUser } => m.user !== undefined)
      .map((m) => toResolved(guildId, m.user, m));
    await c.env.KV.put(cacheKey, JSON.stringify(options), { expirationTtl: 60 });
    return c.json(options);
  } catch (err) {
    if (await handleGuildAccessLoss(c.env, guildId, err)) return c.json({ error: "bot_not_installed" }, 404);
    return c.json({ error: "discord_error" }, 502);
  }
});
