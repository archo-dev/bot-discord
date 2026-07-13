/** XP / levels (M13/M22): settings, message/voice XP grants, leaderboard, rank. */
import { syncGuildModuleStatement } from "./modules.js";

export interface XpSettingsRow {
  guild_id: string;
  enabled: number;
  xp_min: number;
  xp_max: number;
  cooldown_seconds: number;
  announce_level_up: number;
  announce_channel_id: string | null;
  rewards: string;
  voice_enabled: number;
  voice_xp_per_min: number;
}

export async function getXpSettings(db: D1Database, guildId: string): Promise<XpSettingsRow | null> {
  return db.prepare(`SELECT * FROM xp_settings WHERE guild_id = ?1`).bind(guildId).first<XpSettingsRow>();
}

export async function upsertXpSettings(
  db: D1Database,
  guildId: string,
  s: {
    enabled: boolean;
    xpMin: number;
    xpMax: number;
    cooldownSeconds: number;
    announceLevelUp: boolean;
    announceChannelId: string | null;
    rewards: Array<{ level: number; roleId: string }>;
    voiceEnabled: boolean;
    voiceXpPerMin: number;
  },
): Promise<void> {
  const settingsStatement = db.prepare(
      `INSERT INTO xp_settings (guild_id, enabled, xp_min, xp_max, cooldown_seconds, announce_level_up, announce_channel_id, rewards, voice_enabled, voice_xp_per_min)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = ?2, xp_min = ?3, xp_max = ?4, cooldown_seconds = ?5,
         announce_level_up = ?6, announce_channel_id = ?7, rewards = ?8,
         voice_enabled = ?9, voice_xp_per_min = ?10,
         updated_at = datetime('now')`,
    )
    .bind(
      guildId,
      s.enabled ? 1 : 0,
      s.xpMin,
      s.xpMax,
      s.cooldownSeconds,
      s.announceLevelUp ? 1 : 0,
      s.announceChannelId,
      JSON.stringify(s.rewards),
      s.voiceEnabled ? 1 : 0,
      s.voiceXpPerMin,
    );
  await db.batch([settingsStatement, syncGuildModuleStatement(db, guildId, "levels", s.enabled)]);
}

export interface XpMemberRow {
  guild_id: string;
  user_id: string;
  username: string | null;
  xp: number;
  level: number;
  messages: number;
  voice_minutes: number;
}

/** Adds XP (upsert) and returns the member's new totals. */
export async function grantXp(
  db: D1Database,
  guildId: string,
  userId: string,
  username: string | null,
  amount: number,
): Promise<XpMemberRow> {
  const row = await db
    .prepare(
      `INSERT INTO xp_members (guild_id, user_id, username, xp, messages, last_xp_at)
       VALUES (?1, ?2, ?3, ?4, 1, datetime('now'))
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         xp = xp + ?4, messages = messages + 1, username = COALESCE(?3, username), last_xp_at = datetime('now')
       RETURNING *`,
    )
    .bind(guildId, userId, username, amount)
    .first<XpMemberRow>();
  return row!;
}

/** Adds voice XP + voice minutes (upsert), without touching the message count. */
export async function grantVoiceXp(
  db: D1Database,
  guildId: string,
  userId: string,
  username: string | null,
  amount: number,
  minutes: number,
): Promise<XpMemberRow> {
  const row = await db
    .prepare(
      `INSERT INTO xp_members (guild_id, user_id, username, xp, voice_minutes, last_xp_at)
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         xp = xp + ?4, voice_minutes = voice_minutes + ?5, username = COALESCE(?3, username), last_xp_at = datetime('now')
       RETURNING *`,
    )
    .bind(guildId, userId, username, amount, minutes)
    .first<XpMemberRow>();
  return row!;
}

export async function setXpLevel(db: D1Database, guildId: string, userId: string, level: number): Promise<void> {
  await db.prepare(`UPDATE xp_members SET level = ?3 WHERE guild_id = ?1 AND user_id = ?2`).bind(guildId, userId, level).run();
}

export async function getXpMember(db: D1Database, guildId: string, userId: string): Promise<XpMemberRow | null> {
  return db.prepare(`SELECT * FROM xp_members WHERE guild_id = ?1 AND user_id = ?2`).bind(guildId, userId).first<XpMemberRow>();
}

export async function listXpLeaderboard(db: D1Database, guildId: string, limit: number): Promise<XpMemberRow[]> {
  return (
    await db
      .prepare(`SELECT * FROM xp_members WHERE guild_id = ?1 ORDER BY xp DESC LIMIT ?2`)
      .bind(guildId, limit)
      .all<XpMemberRow>()
  ).results;
}

/** 1-based leaderboard position for a given XP total. */
export async function xpRank(db: D1Database, guildId: string, xp: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS above FROM xp_members WHERE guild_id = ?1 AND xp > ?2`)
    .bind(guildId, xp)
    .first<{ above: number }>();
  return (row?.above ?? 0) + 1;
}
