-- Stats collection (M18). Written by the gateway via /internal, read by the
-- Stats page (M19). Retention is enforced by the daily cron (src/cron.ts).

-- Hourly member counts. bucket = 'YYYY-MM-DDTHH:00' (UTC). The T00:00 bucket of
-- each day is the "daily" snapshot kept long-term; other hours are pruned at 14d.
CREATE TABLE member_snapshots (
  guild_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  total INTEGER NOT NULL,
  humans INTEGER NOT NULL,
  bots INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, bucket)
);

-- Per-channel, per-day activity. Upserted additively (message_count / voice_seconds
-- accumulate across the gateway's 60 s flushes). day = 'YYYY-MM-DD' (UTC).
CREATE TABLE channel_activity (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  day TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  voice_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, channel_id, day)
);
CREATE INDEX idx_channel_activity_guild_day ON channel_activity (guild_id, day);
