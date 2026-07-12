/** Voice activity logs (M17): batch insert + keyset-paginated history. */

export interface VoiceLogRow {
  id: number;
  guild_id: string;
  user_id: string;
  user_tag: string | null;
  action: "join" | "leave" | "move" | "mute" | "unmute" | "deafen" | "undeafen";
  channel_id: string | null;
  from_channel_id: string | null;
  created_at: string;
}

export interface VoiceLogEntry {
  userId: string;
  userTag: string | null;
  action: VoiceLogRow["action"];
  channelId: string | null;
  fromChannelId: string | null;
}

/** Batch-inserts voice entries (posted by the gateway in 5 s buffers). */
export async function insertVoiceLogs(db: D1Database, guildId: string, entries: VoiceLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const statements = entries.map((e) =>
    db
      .prepare(
        `INSERT INTO voice_logs (guild_id, user_id, user_tag, action, channel_id, from_channel_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(guildId, e.userId, e.userTag, e.action, e.channelId, e.fromChannelId),
  );
  await db.batch(statements);
}

/**
 * Keyset-paginated voice history (newest first). Cursor is the last row's
 * `created_at|id`; passing it returns the next page. Returns `limit`+1-driven
 * `nextCursor` (null on the last page).
 */
export async function listVoiceLogs(
  db: D1Database,
  guildId: string,
  opts: {
    userId?: string;
    channelId?: string;
    action?: string;
    from?: string;
    to?: string;
    cursor?: { createdAt: string; id: number };
    limit: number;
  },
): Promise<{ rows: VoiceLogRow[]; nextCursor: string | null }> {
  const where: string[] = ["guild_id = ?1"];
  const binds: unknown[] = [guildId];
  const add = (clause: (n: number) => string, value: unknown) => {
    binds.push(value);
    where.push(clause(binds.length));
  };
  if (opts.userId) add((n) => `user_id = ?${n}`, opts.userId);
  if (opts.channelId) {
    binds.push(opts.channelId);
    where.push(`(channel_id = ?${binds.length} OR from_channel_id = ?${binds.length})`);
  }
  if (opts.action) add((n) => `action = ?${n}`, opts.action);
  if (opts.from) add((n) => `created_at >= ?${n}`, opts.from);
  if (opts.to) add((n) => `created_at <= ?${n}`, opts.to);
  if (opts.cursor) {
    binds.push(opts.cursor.createdAt, opts.cursor.createdAt, opts.cursor.id);
    where.push(`(created_at < ?${binds.length - 2} OR (created_at = ?${binds.length - 1} AND id < ?${binds.length}))`);
  }
  const limit = Math.min(Math.max(opts.limit, 1), 100);
  const rows = await db
    .prepare(`SELECT * FROM voice_logs WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`)
    .bind(...binds)
    .all<VoiceLogRow>();
  const results = rows.results;
  let nextCursor: string | null = null;
  if (results.length > limit) {
    const last = results[limit - 1]!;
    nextCursor = `${last.created_at}|${last.id}`;
    results.length = limit;
  }
  return { rows: results, nextCursor };
}
