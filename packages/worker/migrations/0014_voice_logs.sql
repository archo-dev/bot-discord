-- Voice activity history (M17). join/leave/move are always persisted so the
-- panel history is independent of the log channel; mute/deafen are persisted
-- only when the "voice state" toggle is on. from_channel_id is set for moves.
CREATE TABLE voice_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_tag TEXT,
  action TEXT NOT NULL CHECK (action IN ('join','leave','move','mute','unmute','deafen','undeafen')),
  channel_id TEXT,
  from_channel_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_voice_logs_guild ON voice_logs (guild_id, created_at DESC);
CREATE INDEX idx_voice_logs_guild_user ON voice_logs (guild_id, user_id, created_at DESC);

-- Per-event log-channel toggles (embeds). Persistence of join/leave/move does
-- not depend on these; they only gate whether an embed is posted.
ALTER TABLE log_settings ADD COLUMN log_voice_join INTEGER NOT NULL DEFAULT 0;
ALTER TABLE log_settings ADD COLUMN log_voice_leave INTEGER NOT NULL DEFAULT 0;
ALTER TABLE log_settings ADD COLUMN log_voice_move INTEGER NOT NULL DEFAULT 0;
ALTER TABLE log_settings ADD COLUMN log_voice_state INTEGER NOT NULL DEFAULT 0;
