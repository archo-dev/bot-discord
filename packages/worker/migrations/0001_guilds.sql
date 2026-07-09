-- Guilds where the bot is (or was) installed, plus general per-guild config.
CREATE TABLE guilds (
  id                   TEXT PRIMARY KEY,          -- guild snowflake
  name                 TEXT NOT NULL,
  icon                 TEXT,
  bot_installed        INTEGER NOT NULL DEFAULT 1,
  log_channel_id       TEXT,
  warn_threshold       INTEGER NOT NULL DEFAULT 3,
  warn_timeout_minutes INTEGER NOT NULL DEFAULT 60,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT
);
