CREATE TABLE warnings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL REFERENCES guilds(id),
  user_id      TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT,
  revoked_by   TEXT
);
CREATE INDEX idx_warnings_guild_user ON warnings(guild_id, user_id, revoked_at);

CREATE TABLE mod_actions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL REFERENCES guilds(id),
  action       TEXT NOT NULL CHECK (action IN ('ban','unban','kick','timeout','auto_timeout','warn','unwarn','clear')),
  target_id    TEXT,
  moderator_id TEXT NOT NULL,                     -- user snowflake, or 'system' for auto_timeout
  reason       TEXT,
  metadata     TEXT,                              -- JSON: {durationMinutes}, {deletedCount, channelId}...
  source       TEXT NOT NULL DEFAULT 'interaction' CHECK (source IN ('interaction','panel','gateway')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mod_actions_guild_time ON mod_actions(guild_id, created_at DESC);
CREATE INDEX idx_mod_actions_guild_target ON mod_actions(guild_id, target_id);
