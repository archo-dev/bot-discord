-- Self-assignable roles via message buttons (works over HTTP interactions).
CREATE TABLE button_role_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL REFERENCES guilds(id),
  channel_id  TEXT NOT NULL,
  message_id  TEXT,                                  -- set after the Discord message is posted
  title       TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_brm_guild ON button_role_messages(guild_id);

CREATE TABLE button_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_ref INTEGER NOT NULL,                      -- button_role_messages.id
  guild_id    TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  label       TEXT NOT NULL,
  emoji       TEXT,
  style       INTEGER NOT NULL DEFAULT 2,            -- Discord button style 1-4
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_br_message ON button_roles(message_ref);
