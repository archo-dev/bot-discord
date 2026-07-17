/** M05 — idempotency ledger + effect statement builders for reliable delivery. */

import type { ReliableEnvelope } from "@bot/shared";

/** Event ids already applied, looked up in one query (dedup fast path). */
export async function findProcessedEvents(db: D1Database, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const placeholders = eventIds.map((_, i) => `?${i + 1}`).join(",");
  const rows = await db
    .prepare(`SELECT event_id FROM processed_events WHERE event_id IN (${placeholders})`)
    .bind(...eventIds)
    .all<{ event_id: string }>();
  return new Set(rows.results.map((r) => r.event_id));
}

/** The dedup marker insert. Ordered LAST in the atomic batch so a duplicate rolls the effect back. */
function processedInsert(db: D1Database, eventId: string, type: string, now: number): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO processed_events (event_id, event_type, processed_at) VALUES (?1, ?2, ?3)`)
    .bind(eventId, type, now);
}

/**
 * D1 statements that apply one reliable event's effect. Kept pure (no execution)
 * so the route can compose [effect..., processedInsert] into a single atomic
 * db.batch — dedup and effect commit or roll back together.
 */
function effectStatements(db: D1Database, env: ReliableEnvelope, now: number): D1PreparedStatement[] {
  const g = env.guildId;
  switch (env.type) {
    case "voice_log": {
      const p = env.payload;
      return [
        db
          .prepare(
            `INSERT INTO voice_logs (guild_id, user_id, user_tag, action, channel_id, from_channel_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          )
          .bind(g, p.userId, p.userTag, p.action, p.channelId, p.fromChannelId),
      ];
    }
    case "channel_activity": {
      const p = env.payload;
      return [
        db
          .prepare(
            `INSERT INTO channel_activity (guild_id, channel_id, day, message_count, voice_seconds)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(guild_id, channel_id, day) DO UPDATE SET
               message_count = message_count + excluded.message_count,
               voice_seconds = voice_seconds + excluded.voice_seconds`,
          )
          .bind(g, p.channelId, p.day, p.messageCount, p.voiceSeconds),
      ];
    }
    case "member_snapshot": {
      const p = env.payload;
      return [
        db
          .prepare(
            `INSERT OR REPLACE INTO member_snapshots (guild_id, bucket, total, humans, bots)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
          )
          .bind(g, p.bucket, p.total, p.humans, p.bots),
      ];
    }
    case "gateway_event": {
      const p = env.payload;
      return [
        db
          .prepare(`INSERT INTO gateway_events (guild_id, event_type, payload) VALUES (?1, ?2, ?3)`)
          .bind(g, p.eventType, JSON.stringify(p.payload)),
      ];
    }
    case "automation_event": {
      const p = env.payload;
      return [
        db.prepare(
          `INSERT OR IGNORE INTO automation_event_queue
             (id, guild_id, trigger_type, context, correlation_id, root_event_id, depth, expires_at,
              status, attempts, available_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', 0, ?9, ?9, ?9)`,
        ).bind(
          env.eventId, env.guildId, p.context.event.type, JSON.stringify(p.context), p.correlationId,
          p.rootEventId, p.depth, env.occurredAt + 10 * 60_000, now,
        ),
      ];
    }
  }
}

/**
 * Applies one reliable event atomically with its dedup marker. The caller has
 * already confirmed the event is not in {@link findProcessedEvents}; a rare race
 * (concurrent duplicate) fails the batch on the PK conflict and is reported as a
 * retry — safe, since the atomic rollback means no partial apply.
 */
export async function applyReliableEvent(db: D1Database, env: ReliableEnvelope, now: number): Promise<void> {
  await db.batch([...effectStatements(db, env, now), processedInsert(db, env.eventId, env.type, now)]);
}

/** Retention purge (daily cron): drop dedup markers older than the retry window. */
export async function purgeProcessedEvents(db: D1Database, retentionMs = 48 * 3600 * 1000): Promise<number> {
  const res = await db
    .prepare(`DELETE FROM processed_events WHERE processed_at < ?1`)
    .bind(Date.now() - retentionMs)
    .run();
  return res.meta.changes ?? 0;
}
