-- M13: XP/levels. Gains detected by the gateway (memory cooldown), granted by
-- the Worker via POST /internal/guilds/:id/xp (level curve, reward roles,
-- level-up announcement).
CREATE TABLE xp_settings (
  guild_id            TEXT PRIMARY KEY REFERENCES guilds(id),
  enabled             INTEGER NOT NULL DEFAULT 0,
  xp_min              INTEGER NOT NULL DEFAULT 15,
  xp_max              INTEGER NOT NULL DEFAULT 25,
  cooldown_seconds    INTEGER NOT NULL DEFAULT 60,
  announce_level_up   INTEGER NOT NULL DEFAULT 1,
  announce_channel_id TEXT,                      -- NULL = channel of the message
  rewards             TEXT NOT NULL DEFAULT '[]', -- JSON [{level, roleId}]
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE xp_members (
  guild_id   TEXT NOT NULL REFERENCES guilds(id),
  user_id    TEXT NOT NULL,
  username   TEXT,                               -- refreshed on each grant (leaderboard display)
  xp         INTEGER NOT NULL DEFAULT 0,
  level      INTEGER NOT NULL DEFAULT 0,
  messages   INTEGER NOT NULL DEFAULT 0,
  last_xp_at TEXT,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_xp_members_guild_xp ON xp_members(guild_id, xp DESC);
