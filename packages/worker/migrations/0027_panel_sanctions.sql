-- M27: panel sanctions centre. Additive only; the historic mod_actions log
-- remains the canonical record for commands that predate this migration.
ALTER TABLE mod_actions ADD COLUMN expires_at TEXT;
ALTER TABLE mod_actions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'expired', 'revoked', 'failed'));
ALTER TABLE mod_actions ADD COLUMN revoked_at TEXT;
ALTER TABLE mod_actions ADD COLUMN revoked_by TEXT;
ALTER TABLE mod_actions ADD COLUMN revocation_reason TEXT;
ALTER TABLE mod_actions ADD COLUMN idempotency_key TEXT;
ALTER TABLE warnings ADD COLUMN updated_at TEXT;

CREATE INDEX idx_mod_actions_guild_status_time
  ON mod_actions(guild_id, status, created_at DESC);
CREATE INDEX idx_mod_actions_guild_moderator_time
  ON mod_actions(guild_id, moderator_id, created_at DESC);
CREATE INDEX idx_mod_actions_guild_expires
  ON mod_actions(guild_id, expires_at) WHERE expires_at IS NOT NULL;
CREATE UNIQUE INDEX idx_mod_actions_panel_idempotency
  ON mod_actions(guild_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Exemptions are deliberately per sanction type. A deleted Discord role is
-- retained here and rendered as missing in the panel, never silently ignored.
CREATE TABLE sanction_role_exemptions (
  guild_id TEXT NOT NULL REFERENCES guilds(id),
  sanction_type TEXT NOT NULL CHECK (sanction_type IN ('warn', 'timeout', 'kick', 'ban')),
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  PRIMARY KEY (guild_id, sanction_type, role_id)
);
CREATE INDEX idx_sanction_role_exemptions_guild_type
  ON sanction_role_exemptions(guild_id, sanction_type);

-- A claim is made before a panel mutation is sent to Discord. Retrying the
-- same key never repeats a potentially destructive Discord REST call.
CREATE TABLE panel_sanction_requests (
  guild_id TEXT NOT NULL REFERENCES guilds(id),
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action_id INTEGER REFERENCES mod_actions(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, idempotency_key)
);
