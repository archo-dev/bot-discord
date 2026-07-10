import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { levelFromXp } from "@bot/shared";
import type { XpRewardDto } from "@bot/shared";
import {
  activeWarningCount,
  getAutomodSettings,
  getGuild,
  getLogSettings,
  getWelcomeSettings,
  getPlaylist,
  getXpSettings,
  grantXp,
  insertGatewayEvent,
  insertModAction,
  insertWarning,
  listAutoRoles,
  listCustomCommands,
  setXpLevel,
  upsertPlaylist,
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

// Music playback snapshot from the gateway → KV (short TTL) for the panel.
internalRouter.post("/internal/guilds/:guildId/music-state", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) return c.json({ error: "invalid_body" }, 400);
  // 60 s = KV minimum TTL; the gateway refreshes every 15 s while playing, so a
  // stale key clears within a minute of the gateway going silent.
  await c.env.KV.put(`music:${c.req.param("guildId")}`, JSON.stringify(body), { expirationTtl: 60 });
  return c.json({ ok: true });
});

const playlistSaveSchema = z.object({
  ownerId: z.string().regex(/^\d{5,20}$/),
  name: z.string().min(1).max(60),
  tracks: z
    .array(
      z.object({
        title: z.string().max(300),
        url: z.string().max(500),
        duration: z.number(),
        thumbnail: z.string().nullable(),
        requestedBy: z.string().nullable(),
      }),
    )
    .max(200),
});

internalRouter.post("/internal/guilds/:guildId/playlists", async (c) => {
  const parsed = playlistSaveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await upsertPlaylist(c.env.DB, c.req.param("guildId"), parsed.data.ownerId, parsed.data.name, JSON.stringify(parsed.data.tracks));
  return c.json({ ok: true }, 201);
});

internalRouter.get("/internal/guilds/:guildId/playlists/:name", async (c) => {
  const row = await getPlaylist(c.env.DB, c.req.param("guildId"), c.req.param("name"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ tracks: JSON.parse(row.tracks) as unknown });
});

const heartbeatSchema = z.object({
  guildCount: z.number().int().min(0),
  wsPing: z.number().nullable().optional(),
});

// Posted every 120 s by the gateway; the KV TTL (300 s) makes a silent gateway
// read as disconnected without any cleanup job (panel badge = key presence).
// Interval/TTL kept above 60 s to stay under the free KV write quota (1000/day).
internalRouter.post("/internal/gateway/heartbeat", async (c) => {
  const parsed = heartbeatSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await c.env.KV.put(
    "gateway:status",
    JSON.stringify({ at: Date.now(), guildCount: parsed.data.guildCount, wsPing: parsed.data.wsPing ?? null }),
    { expirationTtl: 300 },
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
    xp: await (async () => {
      const s = await getXpSettings(c.env.DB, guildId);
      return { enabled: s ? s.enabled === 1 : false, cooldownSeconds: s?.cooldown_seconds ?? 60 };
    })(),
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

const xpGrantSchema = z.object({
  userId: z.string().regex(/^\d{5,20}$/),
  username: z.string().max(100).nullable().optional(),
  channelId: z.string().regex(/^\d{5,20}$/),
});

/**
 * XP grant, driven by the gateway (which enforces the per-user cooldown in
 * memory). The Worker owns the curve, reward roles and the announcement.
 */
internalRouter.post("/internal/guilds/:guildId/xp", async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = xpGrantSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { userId, username, channelId } = parsed.data;

  const settings = await getXpSettings(c.env.DB, guildId);
  if (!settings || settings.enabled !== 1) return c.json({ ok: true, skipped: true });

  const amount = settings.xp_min + Math.floor(Math.random() * (settings.xp_max - settings.xp_min + 1));
  const member = await grantXp(c.env.DB, guildId, userId, username ?? null, amount);
  const newLevel = levelFromXp(member.xp);
  if (newLevel <= member.level) return c.json({ ok: true, xp: member.xp, level: member.level, leveledUp: false });

  await setXpLevel(c.env.DB, guildId, userId, newLevel);

  // Reward roles: catch-up on everything ≤ newLevel so a missed level-up
  // (bot offline, role deleted then recreated…) heals itself.
  const rewards = (JSON.parse(settings.rewards) as XpRewardDto[]).filter((r) => r.level <= newLevel);
  for (const reward of rewards) {
    try {
      await discordJson(c.env, "PUT", `/guilds/${guildId}/members/${userId}/roles/${reward.roleId}`, undefined, {
        auditLogReason: `Récompense de niveau ${reward.level}`,
      });
    } catch (err) {
      console.error(`xp reward role ${reward.roleId} failed:`, err);
    }
  }

  if (settings.announce_level_up === 1) {
    try {
      await discordJson(c.env, "POST", `/channels/${settings.announce_channel_id ?? channelId}/messages`, {
        content: `🎉 <@${userId}> passe au niveau **${newLevel}** !`,
        allowed_mentions: { users: [userId] },
      });
    } catch (err) {
      console.error("xp announce failed:", err);
    }
  }

  return c.json({ ok: true, xp: member.xp, level: newLevel, leveledUp: true });
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
