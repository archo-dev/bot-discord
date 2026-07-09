-- Gateway-dependent features, modeled from day one so the future always-on
-- gateway service (Option B) plugs in without schema changes. The panel shows
-- these as "requires gateway service" until then.
CREATE TABLE auto_roles (
  guild_id   TEXT NOT NULL REFERENCES guilds(id),
  role_id    TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, role_id)
);

-- Events written by the future gateway service through the /internal API.
CREATE TABLE gateway_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('member_join','member_leave','automod_action','keyword_trigger')),
  payload    TEXT NOT NULL,                       -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_gateway_events_guild ON gateway_events(guild_id, created_at DESC);
