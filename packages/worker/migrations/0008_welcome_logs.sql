-- M11: welcome/leave messages + server log settings, consumed by the gateway
-- through GET /internal/guilds/:id/config (one row per guild, upserted).
CREATE TABLE welcome_settings (
  guild_id           TEXT PRIMARY KEY REFERENCES guilds(id),
  welcome_enabled    INTEGER NOT NULL DEFAULT 0,
  welcome_channel_id TEXT,
  welcome_message    TEXT NOT NULL DEFAULT 'Bienvenue {mention} sur {server} !',
  leave_enabled      INTEGER NOT NULL DEFAULT 0,
  leave_channel_id   TEXT,
  leave_message      TEXT NOT NULL DEFAULT '{user} a quitté le serveur.',
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE log_settings (
  guild_id           TEXT PRIMARY KEY REFERENCES guilds(id),
  channel_id         TEXT,
  log_member_join    INTEGER NOT NULL DEFAULT 0,
  log_member_leave   INTEGER NOT NULL DEFAULT 0,
  log_message_delete INTEGER NOT NULL DEFAULT 0,
  log_message_edit   INTEGER NOT NULL DEFAULT 0,
  log_member_update  INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
