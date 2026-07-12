-- Starboard (M23). Messages that reach a star threshold are reposted as an
-- embed to a dedicated channel; the embed updates as the count changes and is
-- removed when it drops below the threshold. Detection = gateway reaction
-- listener; posting/editing/tracking = Worker (REST + D1), like XP.

CREATE TABLE starboard_settings (
  guild_id   TEXT PRIMARY KEY REFERENCES guilds(id),
  enabled    INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT,                          -- NULL = not configured
  threshold  INTEGER NOT NULL DEFAULT 3,
  emoji      TEXT NOT NULL DEFAULT '⭐',    -- unicode char, or a custom emoji id
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per starred source message. starboard_message_id is the posted embed
-- in the starboard channel (NULL until the threshold is first crossed).
CREATE TABLE starboard_posts (
  guild_id             TEXT NOT NULL,
  message_id           TEXT NOT NULL,       -- the original (source) message
  channel_id           TEXT NOT NULL,       -- the original message's channel
  starboard_message_id TEXT,
  star_count           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, message_id)
);
