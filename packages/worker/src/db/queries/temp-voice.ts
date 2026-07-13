/** Salons vocaux temporaires (M26) : réglages + registre des salons vivants. */

import { syncGuildModuleStatement } from "./modules.js";

export interface TempVoiceSettingsRow {
  guild_id: string;
  enabled: number;
  lobby_channel_id: string | null;
  category_id: string | null;
  lobby_created_by_bot: number;
  name_template: string;
  user_limit: number;
  max_channels: number;
}

export interface TempVoiceChannelRow {
  channel_id: string;
  guild_id: string;
  owner_id: string;
  last_renamed_at: string | null;
  created_at: string;
}

export async function getTempVoiceSettings(db: D1Database, guildId: string): Promise<TempVoiceSettingsRow | null> {
  return db
    .prepare(`SELECT * FROM guild_tempvoice_settings WHERE guild_id = ?1`)
    .bind(guildId)
    .first<TempVoiceSettingsRow>();
}

export async function upsertTempVoiceSettings(
  db: D1Database,
  guildId: string,
  s: {
    enabled: boolean;
    lobbyChannelId: string | null;
    categoryId: string | null;
    lobbyCreatedByBot: boolean;
    nameTemplate: string;
    userLimit: number;
    maxChannels: number;
  },
): Promise<void> {
  const settingsStatement = db.prepare(
      `INSERT INTO guild_tempvoice_settings
         (guild_id, enabled, lobby_channel_id, category_id, lobby_created_by_bot, name_template, user_limit, max_channels)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = ?2, lobby_channel_id = ?3, category_id = ?4, lobby_created_by_bot = ?5,
         name_template = ?6, user_limit = ?7, max_channels = ?8, updated_at = datetime('now')`,
    )
    .bind(
      guildId,
      s.enabled ? 1 : 0,
      s.lobbyChannelId,
      s.categoryId,
      s.lobbyCreatedByBot ? 1 : 0,
      s.nameTemplate,
      s.userLimit,
      s.maxChannels,
    );
  await db.batch([settingsStatement, syncGuildModuleStatement(db, guildId, "temp_voice", s.enabled)]);
}

/** Disables the system. Optionally clears the lobby reference (on reset / lobby deleted). */
export async function disableTempVoice(db: D1Database, guildId: string, opts: { clearLobby: boolean }): Promise<void> {
  let settingsStatement: D1PreparedStatement;
  if (opts.clearLobby) {
    settingsStatement = db.prepare(
        `UPDATE guild_tempvoice_settings
         SET enabled = 0, lobby_channel_id = NULL, lobby_created_by_bot = 0, updated_at = datetime('now')
         WHERE guild_id = ?1`,
      )
      .bind(guildId);
  } else {
    settingsStatement = db.prepare(`UPDATE guild_tempvoice_settings SET enabled = 0, updated_at = datetime('now') WHERE guild_id = ?1`)
      .bind(guildId);
  }
  await db.batch([settingsStatement, syncGuildModuleStatement(db, guildId, "temp_voice", false)]);
}

export async function insertTempVoiceChannel(
  db: D1Database,
  guildId: string,
  channelId: string,
  ownerId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO temp_voice_channels (channel_id, guild_id, owner_id) VALUES (?1, ?2, ?3)
       ON CONFLICT(channel_id) DO UPDATE SET owner_id = ?3`,
    )
    .bind(channelId, guildId, ownerId)
    .run();
}

export async function getTempVoiceChannel(db: D1Database, channelId: string): Promise<TempVoiceChannelRow | null> {
  return db
    .prepare(`SELECT * FROM temp_voice_channels WHERE channel_id = ?1`)
    .bind(channelId)
    .first<TempVoiceChannelRow>();
}

export async function deleteTempVoiceChannel(db: D1Database, guildId: string, channelId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM temp_voice_channels WHERE guild_id = ?1 AND channel_id = ?2`)
    .bind(guildId, channelId)
    .run();
}

export async function listTempVoiceChannels(db: D1Database, guildId: string): Promise<TempVoiceChannelRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM temp_voice_channels WHERE guild_id = ?1`)
    .bind(guildId)
    .all<TempVoiceChannelRow>();
  return results;
}

export async function listAllTempVoiceChannels(db: D1Database): Promise<TempVoiceChannelRow[]> {
  const { results } = await db.prepare(`SELECT * FROM temp_voice_channels`).all<TempVoiceChannelRow>();
  return results;
}

export async function countTempVoiceChannels(db: D1Database, guildId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM temp_voice_channels WHERE guild_id = ?1`)
    .bind(guildId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setTempVoiceOwner(db: D1Database, channelId: string, ownerId: string): Promise<void> {
  await db.prepare(`UPDATE temp_voice_channels SET owner_id = ?2 WHERE channel_id = ?1`).bind(channelId, ownerId).run();
}

export async function setTempVoiceRenamedAt(db: D1Database, channelId: string): Promise<void> {
  await db
    .prepare(`UPDATE temp_voice_channels SET last_renamed_at = datetime('now') WHERE channel_id = ?1`)
    .bind(channelId)
    .run();
}

/** Removes every registered temp channel for a guild (on /tempvoice reset). */
export async function purgeTempVoiceChannels(db: D1Database, guildId: string): Promise<void> {
  await db.prepare(`DELETE FROM temp_voice_channels WHERE guild_id = ?1`).bind(guildId).run();
}
