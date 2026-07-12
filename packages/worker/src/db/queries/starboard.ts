/** Starboard (M23): settings + posted-message tracking. */

export interface StarboardSettingsRow {
  guild_id: string;
  enabled: number;
  channel_id: string | null;
  threshold: number;
  emoji: string;
}

export async function getStarboardSettings(db: D1Database, guildId: string): Promise<StarboardSettingsRow | null> {
  return db.prepare(`SELECT * FROM starboard_settings WHERE guild_id = ?1`).bind(guildId).first<StarboardSettingsRow>();
}

export async function upsertStarboardSettings(
  db: D1Database,
  guildId: string,
  s: { enabled: boolean; channelId: string | null; threshold: number; emoji: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO starboard_settings (guild_id, enabled, channel_id, threshold, emoji)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = ?2, channel_id = ?3, threshold = ?4, emoji = ?5, updated_at = datetime('now')`,
    )
    .bind(guildId, s.enabled ? 1 : 0, s.channelId, s.threshold, s.emoji)
    .run();
}

export interface StarboardPostRow {
  guild_id: string;
  message_id: string;
  channel_id: string;
  starboard_message_id: string | null;
  star_count: number;
}

export async function getStarboardPost(db: D1Database, guildId: string, messageId: string): Promise<StarboardPostRow | null> {
  return db
    .prepare(`SELECT * FROM starboard_posts WHERE guild_id = ?1 AND message_id = ?2`)
    .bind(guildId, messageId)
    .first<StarboardPostRow>();
}

export async function upsertStarboardPost(
  db: D1Database,
  guildId: string,
  messageId: string,
  channelId: string,
  starboardMessageId: string | null,
  starCount: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO starboard_posts (guild_id, message_id, channel_id, starboard_message_id, star_count)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(guild_id, message_id) DO UPDATE SET starboard_message_id = ?4, star_count = ?5`,
    )
    .bind(guildId, messageId, channelId, starboardMessageId, starCount)
    .run();
}

export async function deleteStarboardPost(db: D1Database, guildId: string, messageId: string): Promise<void> {
  await db.prepare(`DELETE FROM starboard_posts WHERE guild_id = ?1 AND message_id = ?2`).bind(guildId, messageId).run();
}
