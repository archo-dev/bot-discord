-- M12: auto-moderation settings, one row per guild, read by the gateway
-- through GET /internal/guilds/:id/config. Sanctions flow back through
-- POST /internal/guilds/:id/automod-sanctions (warnings + mod_actions).
CREATE TABLE automod_settings (
  guild_id                 TEXT PRIMARY KEY REFERENCES guilds(id),
  anti_spam_enabled        INTEGER NOT NULL DEFAULT 0,
  anti_spam_max_messages   INTEGER NOT NULL DEFAULT 5,
  anti_spam_window_seconds INTEGER NOT NULL DEFAULT 5,
  anti_invite_enabled      INTEGER NOT NULL DEFAULT 0,
  anti_link_enabled        INTEGER NOT NULL DEFAULT 0,
  link_whitelist           TEXT NOT NULL DEFAULT '[]',  -- JSON: domains
  banned_words             TEXT NOT NULL DEFAULT '[]',  -- JSON: words
  exempt_role_ids          TEXT NOT NULL DEFAULT '[]',  -- JSON: snowflakes
  exempt_channel_ids       TEXT NOT NULL DEFAULT '[]',  -- JSON: snowflakes
  action                   TEXT NOT NULL DEFAULT 'delete' CHECK (action IN ('delete','warn','timeout')),
  timeout_minutes          INTEGER NOT NULL DEFAULT 10,
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
