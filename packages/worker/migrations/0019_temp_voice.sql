-- Salons vocaux temporaires (M26) : « join to create ». Un salon vocal
-- déclencheur (lobby) ; quand un membre le rejoint, la gateway crée un salon
-- temporaire, y déplace le membre, et le supprime quand il se vide. Détection +
-- création/suppression = gateway (discord.js) ; réglages + registre = Worker (D1).

CREATE TABLE guild_tempvoice_settings (
  guild_id             TEXT PRIMARY KEY REFERENCES guilds(id),
  enabled              INTEGER NOT NULL DEFAULT 0,
  lobby_channel_id     TEXT,                         -- NULL = non configuré
  category_id          TEXT,                         -- NULL = catégorie du lobby
  lobby_created_by_bot INTEGER NOT NULL DEFAULT 0,   -- 1 = supprimable au reset
  name_template        TEXT NOT NULL DEFAULT '🎧・{user}',
  user_limit           INTEGER NOT NULL DEFAULT 0,   -- 0 = illimité
  max_channels         INTEGER NOT NULL DEFAULT 10,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT
);

-- Un enregistrement par salon temporaire vivant. owner_id = propriétaire logique.
CREATE TABLE temp_voice_channels (
  channel_id      TEXT PRIMARY KEY,
  guild_id        TEXT NOT NULL REFERENCES guilds(id),
  owner_id        TEXT NOT NULL,
  last_renamed_at TEXT,                              -- cooldown de renommage
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_temp_voice_guild ON temp_voice_channels(guild_id);
