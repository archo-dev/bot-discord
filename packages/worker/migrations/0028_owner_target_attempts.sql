-- Owner-target attempts are security incidents, not normal moderation flows.
-- The request id is scoped to a guild so retries cannot create extra warns.
CREATE TABLE owner_target_attempts (
  guild_id TEXT NOT NULL REFERENCES guilds(id),
  request_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sanction_type TEXT NOT NULL CHECK (sanction_type IN ('warn', 'timeout', 'kick', 'ban')),
  origin TEXT NOT NULL CHECK (origin IN ('slash', 'panel', 'automation')),
  result TEXT NOT NULL CHECK (result IN ('pending', 'warn_recorded', 'audit_only', 'rate_limited', 'failed')),
  warning_id INTEGER REFERENCES warnings(id),
  mod_action_id INTEGER REFERENCES mod_actions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, request_id)
);
CREATE INDEX idx_owner_target_attempts_guild_actor_time
  ON owner_target_attempts(guild_id, actor_id, created_at DESC);
