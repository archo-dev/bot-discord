/** API interne — XP messages (M13) + XP vocal (M22) : grants, level-up, rôles récompense, annonces. */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { levelFromXp } from "@bot/shared";
import type { XpRewardDto } from "@bot/shared";
import { getXpSettings, grantVoiceXp, grantXp, setXpLevel, type XpMemberRow, type XpSettingsRow } from "../db/queries.js";
import { discordJson } from "../discord/rest.js";
import { withMemberCards } from "../discord/member-card.js";

export const internalXpRouter = new Hono<{ Bindings: Env }>();

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
internalXpRouter.post("/internal/guilds/:guildId/xp", async (c) => {
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
internalXpRouter.post("/internal/guilds/:guildId/voice-xp", async (c) => {
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
