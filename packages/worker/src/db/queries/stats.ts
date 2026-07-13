/** Stats collection (M18/M19): member snapshots, channel activity, retention purge. */

/** Hourly member snapshot; INSERT OR REPLACE so a re-sent bucket overwrites. */
export async function upsertMemberSnapshot(
  db: D1Database,
  guildId: string,
  s: { bucket: string; total: number; humans: number; bots: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO member_snapshots (guild_id, bucket, total, humans, bots)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(guildId, s.bucket, s.total, s.humans, s.bots)
    .run();
}

export interface ChannelActivityEntry {
  channelId: string;
  day: string;
  messageCount: number;
  voiceSeconds: number;
}

/** Additive upsert: repeated flushes for the same channel/day accumulate. */
export async function incrementChannelActivity(
  db: D1Database,
  guildId: string,
  entries: ChannelActivityEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const statements = entries.map((e) =>
    db
      .prepare(
        `INSERT INTO channel_activity (guild_id, channel_id, day, message_count, voice_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(guild_id, channel_id, day) DO UPDATE SET
           message_count = message_count + excluded.message_count,
           voice_seconds = voice_seconds + excluded.voice_seconds`,
      )
      .bind(guildId, e.channelId, e.day, e.messageCount, e.voiceSeconds),
  );
  await db.batch(statements);
}

/**
 * Retention purge (daily cron). Returns rows deleted per table. Bounds (actées) :
 *  - voice_logs        > 90 j
 *  - channel_activity  > 180 j
 *  - member_snapshots  : horaires (bucket != T00:00) > 14 j ; tout > 400 j
 */
export async function purgeOldStats(db: D1Database): Promise<{
  voiceLogs: number;
  channelActivity: number;
  hourlySnapshots: number;
  oldSnapshots: number;
  observabilityMetrics: number;
}> {
  const r = await db.batch([
    db.prepare(`DELETE FROM voice_logs WHERE created_at < datetime('now', '-90 days')`),
    db.prepare(`DELETE FROM channel_activity WHERE day < date('now', '-180 days')`),
    db.prepare(
      `DELETE FROM member_snapshots WHERE bucket NOT LIKE '%T00:00' AND created_at < datetime('now', '-14 days')`,
    ),
    db.prepare(`DELETE FROM member_snapshots WHERE created_at < datetime('now', '-400 days')`),
    db.prepare(`DELETE FROM operation_metrics WHERE bucket < strftime('%Y-%m-%dT%H:00:00Z', 'now', '-30 days')`),
  ]);
  return {
    voiceLogs: r[0]!.meta.changes ?? 0,
    channelActivity: r[1]!.meta.changes ?? 0,
    hourlySnapshots: r[2]!.meta.changes ?? 0,
    oldSnapshots: r[3]!.meta.changes ?? 0,
    observabilityMetrics: r[4]!.meta.changes ?? 0,
  };
}

/** Member snapshots over the last N days; hourly (7d) or daily-only (T00:00). */
export async function listMemberSnapshots(
  db: D1Database,
  guildId: string,
  days: number,
  granularity: "hourly" | "daily",
): Promise<Array<{ bucket: string; total: number; humans: number; bots: number }>> {
  const dailyFilter = granularity === "daily" ? `AND bucket LIKE '%T00:00'` : "";
  return (
    await db
      .prepare(
        `SELECT bucket, total, humans, bots FROM member_snapshots
         WHERE guild_id = ?1 AND created_at >= datetime('now', ?2) ${dailyFilter}
         ORDER BY bucket ASC`,
      )
      .bind(guildId, `-${days} days`)
      .all<{ bucket: string; total: number; humans: number; bots: number }>()
  ).results;
}

/** Daily join/leave counts derived from gateway_events (retroactive). */
export async function listMemberDeltas(
  db: D1Database,
  guildId: string,
  days: number,
): Promise<Array<{ day: string; joins: number; leaves: number }>> {
  return (
    await db
      .prepare(
        `SELECT date(created_at) AS day,
                SUM(CASE WHEN event_type = 'member_join' THEN 1 ELSE 0 END) AS joins,
                SUM(CASE WHEN event_type = 'member_leave' THEN 1 ELSE 0 END) AS leaves
         FROM gateway_events
         WHERE guild_id = ?1 AND event_type IN ('member_join','member_leave') AND created_at >= datetime('now', ?2)
         GROUP BY day ORDER BY day ASC`,
      )
      .bind(guildId, `-${days} days`)
      .all<{ day: string; joins: number; leaves: number }>()
  ).results;
}

/** Top channels by message_count or voice_seconds over the last N days. */
export async function topChannels(
  db: D1Database,
  guildId: string,
  days: number,
  metric: "messages" | "voice",
  limit: number,
): Promise<Array<{ channelId: string; value: number }>> {
  const col = metric === "voice" ? "voice_seconds" : "message_count";
  return (
    await db
      .prepare(
        `SELECT channel_id AS channelId, SUM(${col}) AS value FROM channel_activity
         WHERE guild_id = ?1 AND day >= date('now', ?2)
         GROUP BY channel_id HAVING value > 0 ORDER BY value DESC LIMIT ?3`,
      )
      .bind(guildId, `-${days} days`, limit)
      .all<{ channelId: string; value: number }>()
  ).results;
}
