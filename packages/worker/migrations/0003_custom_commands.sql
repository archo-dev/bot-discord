CREATE TABLE custom_commands (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id             TEXT NOT NULL REFERENCES guilds(id),
  name                 TEXT NOT NULL,             -- ^[a-z0-9_-]{1,32}$, validated in code
  description          TEXT NOT NULL DEFAULT 'Commande personnalisée',
  trigger_type         TEXT NOT NULL DEFAULT 'slash' CHECK (trigger_type IN ('slash','keyword')),
  enabled              INTEGER NOT NULL DEFAULT 1,
  logic                TEXT NOT NULL,             -- versioned JSON, zod-validated on write AND read
  logic_version        INTEGER NOT NULL DEFAULT 1,
  cooldown_seconds     INTEGER NOT NULL DEFAULT 0,
  cooldown_scope       TEXT NOT NULL DEFAULT 'user' CHECK (cooldown_scope IN ('user','guild')),
  required_permissions TEXT,                      -- permission bitfield as decimal string, NULL = everyone
  discord_command_id   TEXT,                      -- snowflake once registered; NULL for keyword triggers
  created_by           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT,
  UNIQUE (guild_id, name)
);
CREATE INDEX idx_custom_commands_guild ON custom_commands(guild_id, enabled);

CREATE TABLE custom_command_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id  INTEGER NOT NULL,                   -- no FK cascade: history survives command deletion
  guild_id    TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('create','update','enable','disable','delete')),
  logic       TEXT NOT NULL,                      -- full snapshot at that revision
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_revisions_command ON custom_command_revisions(command_id, changed_at DESC);
CREATE INDEX idx_revisions_guild ON custom_command_revisions(guild_id, changed_at DESC);
