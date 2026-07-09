-- Fine-grained panel access: which roles/users may use the panel for a guild,
-- in addition to members holding MANAGE_GUILD/ADMINISTRATOR.
CREATE TABLE panel_access (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL REFERENCES guilds(id),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('role','user')),
  subject_id   TEXT NOT NULL,
  added_by     TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guild_id, subject_type, subject_id)
);
CREATE INDEX idx_panel_access_guild ON panel_access(guild_id);

-- Named counters for the increment_counter custom-command action.
CREATE TABLE counters (
  guild_id   TEXT NOT NULL REFERENCES guilds(id),
  name       TEXT NOT NULL,                       -- ^[a-z0-9_-]{1,32}$
  value      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, name)
);
