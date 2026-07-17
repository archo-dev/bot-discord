/** API interne — modération : sanctions automod (warn/timeout + seuil), voice logs, mod actions. */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import {
  activeWarningCount,
  getAutomodSettings,
  getGuild,
  insertModAction,
  insertVoiceLogs,
  insertWarning,
} from "../db/queries.js";
import { automodRowToDto } from "../api/automod.js";
import { discordJson } from "../discord/rest.js";
import { modLogEmbed, postModLog } from "../interactions/builtins/util.js";
import { requireInternalModule } from "./module-guard.js";
import { isDiscordGuildOwner } from "../moderation/owner.js";
import { recordOwnerTargetAttempt } from "../moderation/owner-attempt.js";

export const internalModerationRouter = new Hono<{ Bindings: Env }>();
internalModerationRouter.use("/internal/guilds/:guildId/automod-sanctions", requireInternalModule("automod"));
internalModerationRouter.use("/internal/guilds/:guildId/voice-logs", requireInternalModule("voice_logs"));

const SNOWFLAKE = /^\d{5,20}$/;

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
internalModerationRouter.post("/internal/guilds/:guildId/automod-sanctions", async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = sanctionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { userId, rule, action } = parsed.data;
  // Gateway input is authenticated, but it is still a moderation target.
  if (await isDiscordGuildOwner(c.env, guildId, userId)) {
    try {
      await recordOwnerTargetAttempt(c.env.DB, { guildId, actorId: "automod", ownerId: userId, sanctionType: action === "timeout" ? "timeout" : "warn", origin: "automation", requestId: c.req.header("x-request-id") ?? crypto.randomUUID() });
    } catch (error) {
      console.error("owner-target automation audit failed:", error);
    }
    return c.json({ error: "target_is_guild_owner" }, 403);
  }
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
internalModerationRouter.post("/internal/guilds/:guildId/voice-logs", async (c) => {
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

internalModerationRouter.post("/internal/guilds/:guildId/mod-actions", async (c) => {
  const parsed = modActionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const id = await insertModAction(c.env.DB, {
    guildId: c.req.param("guildId"),
    ...parsed.data,
    source: "gateway",
  });
  return c.json({ ok: true, id }, 201);
});
