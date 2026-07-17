-- Durable per-guild/per-actor fixed-window limiter for automatic owner-target warnings.
CREATE TABLE owner_target_attempt_limits (
  guild_id TEXT NOT NULL REFERENCES guilds(id),
  actor_id TEXT NOT NULL,
  window_start TEXT NOT NULL,
  warn_count INTEGER NOT NULL DEFAULT 0 CHECK (warn_count >= 0 AND warn_count <= 5),
  PRIMARY KEY (guild_id, actor_id, window_start)
);
CREATE INDEX idx_owner_target_attempt_limits_window
  ON owner_target_attempt_limits(window_start);
