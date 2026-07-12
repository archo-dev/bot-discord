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
  grantVoiceXp,
  grantXp,
  incrementChannelActivity,
  insertGatewayEvent,
  insertModAction,
  insertVoiceLogs,
  insertWarning,
  listAutoRoles,
  listCustomCommands,
  setXpLevel,
  upsertMemberSnapshot,
  upsertPlaylist,
  type XpMemberRow,
  type XpSettingsRow,
} from "../db/queries.js";
import { logRowToDto, welcomeRowToDto } from "../api/welcome.js";
import { automodRowToDto } from "../api/automod.js";
import { discordJson } from "../discord/rest.js";
import { withMemberCards } from "../discord/member-card.js";
import { modLogEmbed, postModLog } from "../interactions/builtins/util.js";

/**
 * Internal API for the future always-on Gateway service (Option B).
 * Bearer-token-guarded from day one so the gateway lands without Worker
 * changes. Contract documented in the README.
 */
export const internalRouter = new Hono<{ Bindings: Env }>();

const SNOWFLAKE = /^\d{5,20}$/;

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

const presenceCountsSchema = z.object({
  online: z.number().int().min(0),
  idle: z.number().int().min(0),
  dnd: z.number().int().min(0),
  offline: z.number().int().min(0),
});
const heartbeatSchema = z.object({
  guildCount: z.number().int().min(0),
  wsPing: z.number().nullable().optional(),
  // Per-guild presence counts (M18/M19). Empty/absent until the Presence intent
  // is enabled — the Stats page treats a missing guild as "intent off".
  presence: z.record(z.string(), presenceCountsSchema).optional(),
});

// Posted every 120 s by the gateway; the KV TTL (300 s) makes a silent gateway
// read as disconnected without any cleanup job (panel badge = key presence).
// Interval/TTL kept above 60 s to stay under the free KV write quota (1000/day).
internalRouter.post("/internal/gateway/heartbeat", async (c) => {
  const parsed = heartbeatSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await c.env.KV.put(
    "gateway:status",
    JSON.stringify({
      at: Date.now(),
      guildCount: parsed.data.guildCount,
      wsPing: parsed.data.wsPing ?? null,
      presence: parsed.data.presence ?? null,
    }),
    { expirationTtl: 300 },
  );
  return c.json({ ok: true });
});

// --- Stats collection (M18) ------------------------------------------------

const memberSnapshotSchema = z.object({
  bucket: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/),
  total: z.number().int().min(0),
  humans: z.number().int().min(0),
  bots: z.number().int().min(0),
});

internalRouter.post("/internal/guilds/:guildId/member-snapshots", async (c) => {
  const parsed = memberSnapshotSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await upsertMemberSnapshot(c.env.DB, c.req.param("guildId"), parsed.data);
  return c.json({ ok: true }, 201);
});

const channelActivitySchema = z.object({
  entries: z
    .array(
      z.object({
        channelId: z.string().regex(SNOWFLAKE),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        messageCount: z.number().int().min(0),
        voiceSeconds: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(200),
});

internalRouter.post("/internal/guilds/:guildId/channel-activity", async (c) => {
  const parsed = channelActivitySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await incrementChannelActivity(c.env.DB, c.req.param("guildId"), parsed.data.entries);
  return c.json({ ok: true }, 201);
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
    mentionCards: guild.mention_cards === 1,
    autoRoles: autoRoles.filter((r) => r.enabled === 1).map((r) => r.role_id),
    welcome: welcomeRowToDto(await getWelcomeSettings(c.env.DB, guildId)),
    logs: logRowToDto(await getLogSettings(c.env.DB, guildId)),
    automod: automodRowToDto(await getAutomodSettings(c.env.DB, guildId)),
    xp: await (async () => {
      const s = await getXpSettings(c.env.DB, guildId);
      return {
        enabled: s ? s.enabled === 1 : false,
        cooldownSeconds: s?.cooldown_seconds ?? 60,
        voiceEnabled: s ? s.voice_enabled === 1 : false,
      };
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
 * Applies a level-up when the member crossed a threshold: reward roles (catch-up
 * on everything ≤ new level so a missed level-up heals itself) + optional
 * announcement. Shared by message XP (M13) and voice XP (M22). `fallbackChannelId`
 * is where the announcement lands when no dedicated announce channel is set.
 */
async function processXpLevelUp(
  env: Env,
  guildId: string,
  settings: XpSettingsRow,
  member: XpMemberRow,
  fallbackChannelId: string | null,
): Promise<{ leveledUp: boolean; level: number }> {
  const newLevel = levelFromXp(member.xp);
  if (newLevel <= member.level) return { leveledUp: false, level: member.level };

  await setXpLevel(env.DB, guildId, member.user_id, newLevel);

  const rewards = (JSON.parse(settings.rewards) as XpRewardDto[]).filter((r) => r.level <= newLevel);
  for (const reward of rewards) {
    try {
      await discordJson(env, "PUT", `/guilds/${guildId}/members/${member.user_id}/roles/${reward.roleId}`, undefined, {
        auditLogReason: `Récompense de niveau ${reward.level}`,
      });
    } catch (err) {
      console.error(`xp reward role ${reward.roleId} failed:`, err);
    }
  }

  const announceChannelId = settings.announce_channel_id ?? fallbackChannelId;
  if (settings.announce_level_up === 1 && announceChannelId) {
    try {
      await discordJson(
        env,
        "POST",
        `/channels/${announceChannelId}/messages`,
        await withMemberCards(env, guildId, {
          content: `🎉 <@${member.user_id}> passe au niveau **${newLevel}** !`,
          allowed_mentions: { users: [member.user_id] },
        }),
      );
    } catch (err) {
      console.error("xp announce failed:", err);
    }
  }

  return { leveledUp: true, level: newLevel };
}

/**
 * Message XP grant, driven by the gateway (which enforces the per-user cooldown
 * in memory). The Worker owns the curve, reward roles and the announcement.
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
  const res = await processXpLevelUp(c.env, guildId, settings, member, channelId);
  return c.json({ ok: true, xp: member.xp, level: res.level, leveledUp: res.leveledUp });
});

const voiceXpSchema = z.object({
  entries: z
    .array(
      z.object({
        userId: z.string().regex(/^\d{5,20}$/),
        username: z.string().max(100).nullable().optional(),
        channelId: z.string().regex(/^\d{5,20}$/),
      }),
    )
    .min(1)
    .max(100),
});

/**
 * Voice XP tick (M22): once a minute the gateway posts every member currently
 * eligible in a voice channel. Each earns `voice_xp_per_min` (no message count),
 * with the same curve, reward roles and announcement as message XP. `channelId`
 * is the voice channel, used as the announcement fallback.
 */
internalRouter.post("/internal/guilds/:guildId/voice-xp", async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = voiceXpSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const settings = await getXpSettings(c.env.DB, guildId);
  if (!settings || settings.voice_enabled !== 1) return c.json({ ok: true, skipped: true });

  let granted = 0;
  for (const e of parsed.data.entries) {
    const member = await grantVoiceXp(c.env.DB, guildId, e.userId, e.username ?? null, settings.voice_xp_per_min, 1);
    await processXpLevelUp(c.env, guildId, settings, member, e.channelId);
    granted++;
  }
  return c.json({ ok: true, granted });
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

const voiceLogsSchema = z.object({
  entries: z
    .array(
      z.object({
        userId: z.string().regex(SNOWFLAKE),
        userTag: z.string().max(64).nullable(),
        action: z.enum(["join", "leave", "move", "mute", "unmute", "deafen", "undeafen"]),
        channelId: z.string().regex(SNOWFLAKE).nullable(),
        fromChannelId: z.string().regex(SNOWFLAKE).nullable(),
      }),
    )
    .min(1)
    .max(50),
});

// Voice activity from the gateway (buffered ~5 s, batched). join/leave/move are
// always sent; mute/deafen only when the guild's voice-state toggle is on.
internalRouter.post("/internal/guilds/:guildId/voice-logs", async (c) => {
  const parsed = voiceLogsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await insertVoiceLogs(c.env.DB, c.req.param("guildId"), parsed.data.entries);
  return c.json({ ok: true }, 201);
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
