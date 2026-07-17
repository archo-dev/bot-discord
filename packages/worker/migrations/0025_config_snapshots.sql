-- M07 config backup. Versioned canonical snapshots of allowlisted module config
-- (Config + Automod to start). Never a raw table dump and never a secret: the
-- payload is built by allowlisted serializers. Additive and self-contained; the
-- rest of the schema is untouched, so the feature is fully removable.

CREATE TABLE config_snapshots (
  id             TEXT PRIMARY KEY,            -- uuid
  guild_id       TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  actor_id       TEXT,                        -- panel user who created it, NULL for system
  reason         TEXT NOT NULL,               -- 'manual' | 'pre_restore' | 'pre_import'
  schema_version INTEGER NOT NULL,
  payload_json   TEXT NOT NULL,               -- canonical ConfigBackupPayload JSON
  checksum       TEXT NOT NULL,               -- SHA-256 of the canonical payload
  size_bytes     INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_config_snapshots_guild ON config_snapshots(guild_id, created_at DESC);
