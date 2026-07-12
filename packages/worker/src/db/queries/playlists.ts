/** Saved music playlists (M14). */

export interface PlaylistRow {
  id: number;
  guild_id: string;
  owner_id: string;
  name: string;
  tracks: string;
  created_at: string;
}

export async function upsertPlaylist(
  db: D1Database,
  guildId: string,
  ownerId: string,
  name: string,
  tracksJson: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO playlists (guild_id, owner_id, name, tracks) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(guild_id, name) DO UPDATE SET owner_id = ?2, tracks = ?4, created_at = datetime('now')`,
    )
    .bind(guildId, ownerId, name, tracksJson)
    .run();
}

export async function getPlaylist(db: D1Database, guildId: string, name: string): Promise<PlaylistRow | null> {
  return db.prepare(`SELECT * FROM playlists WHERE guild_id = ?1 AND name = ?2`).bind(guildId, name).first<PlaylistRow>();
}

export async function listPlaylists(db: D1Database, guildId: string): Promise<PlaylistRow[]> {
  return (
    await db.prepare(`SELECT * FROM playlists WHERE guild_id = ?1 ORDER BY name`).bind(guildId).all<PlaylistRow>()
  ).results;
}

export async function deletePlaylist(db: D1Database, guildId: string, name: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM playlists WHERE guild_id = ?1 AND name = ?2`).bind(guildId, name).run();
  return (res.meta.changes ?? 0) > 0;
}
