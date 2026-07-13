-- M02 public security. Additive, bounded, and deliberately free of Discord
-- content, request bodies, tokens, IPs, channel IDs and message IDs.

CREATE TABLE internal_request_nonces (
  direction  TEXT NOT NULL CHECK (direction IN ('gateway-to-worker')),
  nonce_hash TEXT NOT NULL CHECK (length(nonce_hash) = 64),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (direction, nonce_hash)
);
CREATE INDEX idx_internal_request_nonces_expiry ON internal_request_nonces(expires_at);

CREATE TABLE security_quota_usage (
  day         TEXT NOT NULL CHECK (length(day) = 10),
  guild_key   TEXT NOT NULL CHECK (length(guild_key) = 32),
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('guild','user')),
  scope_key   TEXT NOT NULL CHECK (length(scope_key) = 32),
  capability TEXT NOT NULL CHECK (capability IN ('discord_publish','guild_identity','music_control')),
  count       INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, guild_key, scope_type, scope_key, capability)
);
CREATE INDEX idx_security_quota_day ON security_quota_usage(day);

CREATE TABLE admin_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  actor_access TEXT NOT NULL CHECK (actor_access IN ('manage_guild','panel_admin','panel_moderator')),
  capability   TEXT NOT NULL CHECK (capability IN (
    'guild_config_write','guild_identity_write','panel_access_manage','roles_write',
    'roles_publish','moderation_write','commands_write','music_control','tickets_write'
  )),
  method       TEXT NOT NULL CHECK (method IN ('POST','PUT','PATCH','DELETE')),
  target_type  TEXT CHECK (target_type IS NULL OR target_type IN ('command','warning','button_role')),
  target_id    TEXT CHECK (target_id IS NULL OR length(target_id) <= 64),
  outcome      TEXT NOT NULL CHECK (outcome IN ('success','error')),
  status       INTEGER NOT NULL CHECK (status BETWEEN 200 AND 599),
  request_id   TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 64),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_admin_audit_guild_created ON admin_audit_log(guild_id, created_at DESC, id DESC);
CREATE INDEX idx_admin_audit_created ON admin_audit_log(created_at);
