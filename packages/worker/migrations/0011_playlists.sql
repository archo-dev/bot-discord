-- M14: saved playlists, one row per (guild, name). Written by the Worker on
-- the gateway's behalf (POST /internal/guilds/:id/playlists), read for /playlist load.
CREATE TABLE playlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL REFERENCES guilds(id),
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  tracks     TEXT NOT NULL DEFAULT '[]',        -- JSON [{title, url}]
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guild_id, name)
);
CREATE INDEX idx_playlists_guild ON playlists(guild_id);
