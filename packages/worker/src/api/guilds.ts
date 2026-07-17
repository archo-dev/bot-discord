import { Hono } from "hono";
import { z } from "zod";
import { canManageGuild } from "@bot/shared";
import type {
  AutoRoleEntry,
  ChannelOption,
  GuildConfigPatch,
  GuildOverview,
  GuildSummary,
  MeResponse,
  PanelAccessEntry,
  RoleOption,
} from "@bot/shared";
import {
  filterInstalledGuilds,
  getGuild,
  listAutoRoles,
  listPanelAccess,
  replaceAutoRoles,
  replacePanelAccess,
  setGuildNickname,
  updateGuildConfig,
  upsertGuild,
} from "../db/queries.js";
import { DiscordAPIError, discordJson } from "../discord/rest.js";
import { getUserGuilds, handleGuildAccessLoss, requireManageGuild, type AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const guildsRouter = new Hono<AppContext>();

guildsRouter.get("/me", (c) => {
  const s = c.get("session");
  const body: MeResponse = { id: s.userId, username: s.username, globalName: s.globalName, avatar: s.avatar };
  return c.json(body);
});

/**
 * Guilds the panel can manage: user's OAuth guilds with MANAGE_GUILD ∩ guilds
 * where the bot is installed, plus direct user panel grants. (Role-based
 * grants don't appear in this list — those users can still open the guild's
 * panel URL directly; the guard resolves their roles there.)
 */
guildsRouter.get("/guilds", async (c) => {
  const session = c.get("session");
  const userGuilds = await getUserGuilds(c.env, session);
  if (userGuilds === null) return c.json({ error: "session_expired" }, 401);

  const manageable = userGuilds.filter((g) => g.owner || canManageGuild(g.permissions));
  const installed = await filterInstalledGuilds(
    c.env.DB,
    manageable.map((g) => g.id),
  );

  const summaries: GuildSummary[] = manageable
    .filter((g) => installed.has(g.id))
    .map((g) => ({ id: g.id, name: g.name, icon: g.icon, access: "manage_guild" }));

  const grantRows = await c.env.DB.prepare(
    `SELECT pa.guild_id, g.name, g.icon FROM panel_access pa
     JOIN guilds g ON g.id = pa.guild_id AND g.bot_installed = 1
     WHERE pa.subject_type = 'user' AND pa.subject_id = ?1`,
  )
    .bind(session.userId)
    .all<{ guild_id: string; name: string; icon: string | null }>();
  for (const row of grantRows.results) {
    if (!summaries.some((s) => s.id === row.guild_id)) {
      summaries.push({ id: row.guild_id, name: row.name, icon: row.icon, access: "panel_grant" });
    }
  }

  return c.json(summaries);
});

interface RESTGuildWithCounts {
  id: string;
  name: string;
  icon: string | null;
  approximate_member_count?: number;
}

guildsRouter.get("/guilds/:guildId", async (c) => {
  const guildId = c.req.param("guildId");
  const row = (await getGuild(c.env.DB, guildId))!;

  let memberCount: number | null = null;
  let name = row.name;
  let icon = row.icon;
  const cacheKey = `gmeta:${guildId}`;
  const cached = await c.env.KV.get(cacheKey);
  if (cached) {
    const meta = JSON.parse(cached) as { name: string; icon: string | null; count: number | null };
    ({ name, icon } = meta);
    memberCount = meta.count;
  } else {
    try {
      const guild = await discordJson<RESTGuildWithCounts>(c.env, "GET", `/guilds/${guildId}?with_counts=true`);
      name = guild.name;
      icon = guild.icon;
      memberCount = guild.approximate_member_count ?? null;
      await c.env.KV.put(cacheKey, JSON.stringify({ name, icon, count: memberCount }), { expirationTtl: 300 });
      c.executionCtx.waitUntil(upsertGuild(c.env.DB, guildId, name, icon));
    } catch (err) {
      if (await handleGuildAccessLoss(c.env, guildId, err)) return c.json({ error: "bot_not_installed" }, 404);
    }
  }

  const body: GuildOverview = {
    id: guildId,
    name,
    icon,
    approximateMemberCount: memberCount,
    logChannelId: row.log_channel_id,
    warnThreshold: row.warn_threshold,
    warnTimeoutMinutes: row.warn_timeout_minutes,
    customNickname: row.custom_nickname,
    mentionCards: row.mention_cards === 1,
    // Key written by /internal/gateway/heartbeat with a 300 s TTL: presence
    // alone means the gateway phoned home recently.
    gatewayConnected: (await c.env.KV.get("gateway:status")) !== null,
    access: c.get("guildAccess") === "panel_moderator" ? "moderator" : "admin",
  };
  return c.json(body);
});

const configPatchSchema = z.object({
  logChannelId: z.string().regex(/^\d{5,20}$/).nullable().optional(),
  warnThreshold: z.number().int().min(1).max(20).optional(),
  warnTimeoutMinutes: z.number().int().min(1).max(40320).optional(),
  mentionCards: z.boolean().optional(),
});

guildsRouter.patch("/guilds/:guildId/config", rateLimit({ name: "config", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = configPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const patch: GuildConfigPatch = parsed.data;
  await updateGuildConfig(c.env.DB, guildId, {
    ...("logChannelId" in patch ? { log_channel_id: patch.logChannelId ?? null } : {}),
    ...(patch.warnThreshold !== undefined ? { warn_threshold: patch.warnThreshold } : {}),
    ...(patch.warnTimeoutMinutes !== undefined ? { warn_timeout_minutes: patch.warnTimeoutMinutes } : {}),
    ...(patch.mentionCards !== undefined ? { mention_cards: patch.mentionCards ? 1 : 0 } : {}),
  });
  return c.json({ ok: true });
});

// --- Bot nickname (M16) ----------------------------------------------------

const nicknameSchema = z.object({ nickname: z.string().min(1).max(32).nullable() });

/**
 * Sets the bot's nickname on this guild. The value is persisted first so the
 * panel keeps it even when Discord rejects the change; a missing CHANGE_NICKNAME
 * permission returns 409 (stored but not applied) rather than a hard failure.
 * null resets to the bot's default username.
 */
guildsRouter.patch("/guilds/:guildId/nickname", rateLimit({ name: "nickname", limit: 10 }), async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = nicknameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const { nickname } = parsed.data;

  await setGuildNickname(c.env.DB, guildId, nickname);
  try {
    await discordJson(c.env, "PATCH", `/guilds/${guildId}/members/@me`, { nick: nickname });
  } catch (err) {
    // 403 here means the bot lacks CHANGE_NICKNAME — NOT a loss of guild access,
    // so handle it before handleGuildAccessLoss (which would flip bot_installed off).
    if (err instanceof DiscordAPIError && err.status === 403) {
      return c.json({ error: "missing_permission" }, 409);
    }
    if (await handleGuildAccessLoss(c.env, guildId, err)) return c.json({ error: "bot_not_installed" }, 404);
    return c.json({ error: "discord_error" }, 502);
  }
  return c.json({ ok: true });
});

interface RESTChannel {
  id: string;
  name: string;
  type: number;
  position?: number;
}

guildsRouter.get("/guilds/:guildId/channels", async (c) => {
  const guildId = c.req.param("guildId");
  const cacheKey = `channels:v2:${guildId}`;
  const cached = await c.env.KV.get(cacheKey);
  if (cached) return c.json(JSON.parse(cached) as ChannelOption[]);
  try {
    const channels = await discordJson<RESTChannel[]>(c.env, "GET", `/guilds/${guildId}/channels`);
    const options: ChannelOption[] = channels
      // text + announcement + category (tickets) + voice + stage (voice logs, M17).
      // Each panel selector filters by its own `types` prop, so this stays additive.
      .filter((ch) => ch.type === 0 || ch.type === 5 || ch.type === 4 || ch.type === 2 || ch.type === 13)
      .map((ch) => ({ id: ch.id, name: ch.name, type: ch.type, position: ch.position ?? 0 }))
      .sort((a, b) => a.position - b.position);
    await c.env.KV.put(cacheKey, JSON.stringify(options), { expirationTtl: 300 });
    return c.json(options);
  } catch (err) {
    if (await handleGuildAccessLoss(c.env, guildId, err)) return c.json({ error: "bot_not_installed" }, 404);
    return c.json({ error: "discord_error" }, 502);
  }
});

interface RESTRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

guildsRouter.get("/guilds/:guildId/roles", async (c) => {
  const guildId = c.req.param("guildId");
  const cacheKey = `roles:${guildId}`;
  const cached = await c.env.KV.get(cacheKey);
  if (cached) return c.json(JSON.parse(cached) as RoleOption[]);
  try {
    const roles = await discordJson<RESTRole[]>(c.env, "GET", `/guilds/${guildId}/roles`);
    const options: RoleOption[] = roles
      .filter((r) => r.id !== guildId) // drop @everyone
      .map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, managed: r.managed }))
      .sort((a, b) => b.position - a.position);
    await c.env.KV.put(cacheKey, JSON.stringify(options), { expirationTtl: 300 });
    return c.json(options);
  } catch (err) {
    if (await handleGuildAccessLoss(c.env, guildId, err)) return c.json({ error: "bot_not_installed" }, 404);
    return c.json({ error: "discord_error" }, 502);
  }
});

// --- Panel access management (MANAGE_GUILD only) ---------------------------

guildsRouter.get("/guilds/:guildId/panel-access", requireManageGuild, async (c) => {
  const rows = await listPanelAccess(c.env.DB, c.req.param("guildId"));
  const body: PanelAccessEntry[] = rows.map((r) => ({
    id: r.id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    level: r.level,
    addedBy: r.added_by,
    createdAt: r.created_at,
  }));
  return c.json(body);
});

const panelAccessSchema = z
  .array(
    z.object({
      subjectType: z.enum(["role", "user"]),
      subjectId: z.string().regex(/^\d{5,20}$/),
      level: z.enum(["admin", "moderator"]).default("admin"),
    }),
  )
  .max(50);

guildsRouter.put("/guilds/:guildId/panel-access", requireManageGuild, rateLimit({ name: "panel-access", limit: 10 }), async (c) => {
  const parsed = panelAccessSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  await replacePanelAccess(c.env.DB, c.req.param("guildId"), parsed.data, c.get("session").userId);
  return c.json({ ok: true });
});

// --- Auto roles (stored, but inert until the gateway service exists) -------

guildsRouter.get("/guilds/:guildId/auto-roles", async (c) => {
  const rows = await listAutoRoles(c.env.DB, c.req.param("guildId"));
  const body: AutoRoleEntry[] = rows.map((r) => ({
    roleId: r.role_id,
    enabled: r.enabled === 1,
    gatewayRequired: true,
  }));
  return c.json(body);
});

const autoRolesSchema = z.array(z.string().regex(/^\d{5,20}$/)).max(10);

guildsRouter.put("/guilds/:guildId/auto-roles", rateLimit({ name: "auto-roles", limit: 10 }), async (c) => {
  const parsed = autoRolesSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  await replaceAutoRoles(c.env.DB, c.req.param("guildId"), parsed.data);
  return c.json({ ok: true, gatewayRequired: true });
});
