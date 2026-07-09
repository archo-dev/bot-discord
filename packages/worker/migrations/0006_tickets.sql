-- Ticket system: per-guild settings + one row per ticket.
CREATE TABLE ticket_settings (
  guild_id              TEXT PRIMARY KEY REFERENCES guilds(id),
  enabled               INTEGER NOT NULL DEFAULT 0,
  category_id           TEXT,
  panel_channel_id      TEXT,
  panel_message_id      TEXT,
  staff_role_ids        TEXT NOT NULL DEFAULT '[]',   -- JSON array of role ids
  transcript_channel_id TEXT,
  next_number           INTEGER NOT NULL DEFAULT 1,
  updated_at            TEXT
);

CREATE TABLE tickets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL REFERENCES guilds(id),
  number       INTEGER NOT NULL,
  channel_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at    TEXT,
  closed_by    TEXT,
  close_reason TEXT,
  transcript   TEXT,                                  -- plain-text dump, capped at ~500 messages
  UNIQUE (guild_id, number)
);
CREATE INDEX idx_tickets_guild_status ON tickets(guild_id, status);
CREATE INDEX idx_tickets_channel ON tickets(channel_id);
