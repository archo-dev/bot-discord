-- M09: bounded team-ticket workflow. The historic status column remains the
-- compatibility signal for old code: open/pending => status=open, closed =>
-- status=closed. No transcript is copied or rewritten.

ALTER TABLE ticket_settings ADD COLUMN form_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (form_enabled IN (0, 1));
ALTER TABLE ticket_settings ADD COLUMN form_config TEXT;

ALTER TABLE tickets ADD COLUMN state TEXT NOT NULL DEFAULT 'open'
  CHECK (state IN ('open', 'pending', 'closed'));
ALTER TABLE tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal', 'high'));
ALTER TABLE tickets ADD COLUMN category_key TEXT;
ALTER TABLE tickets ADD COLUMN assignee_id TEXT;
ALTER TABLE tickets ADD COLUMN assigned_at TEXT;
ALTER TABLE tickets ADD COLUMN updated_at TEXT;
ALTER TABLE tickets ADD COLUMN form_response TEXT;

UPDATE tickets
SET state = CASE WHEN status = 'closed' THEN 'closed' ELSE 'open' END,
    updated_at = COALESCE(closed_at, created_at);

CREATE INDEX idx_tickets_guild_state_time
  ON tickets(guild_id, state, created_at DESC);
CREATE INDEX idx_tickets_guild_assignee_state
  ON tickets(guild_id, assignee_id, state) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_tickets_guild_priority_state
  ON tickets(guild_id, priority, state);

-- A short-lived durable claim prevents two concurrent interactions from
-- creating two active channels for the same member. Existing open tickets are
-- seeded deterministically without modifying them.
CREATE TABLE ticket_open_claims (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, user_id)
);

INSERT OR IGNORE INTO ticket_open_claims (guild_id, user_id, ticket_id, created_at)
SELECT guild_id, user_id, MIN(id), MIN(created_at)
FROM tickets
WHERE status = 'open'
GROUP BY guild_id, user_id;

-- Metadata only: form answers and transcripts remain on the ticket and are
-- fetched explicitly. The timeline is bounded by query-side retention.
CREATE TABLE ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'created', 'assigned', 'unassigned', 'state_changed',
    'priority_changed', 'closed'
  )),
  actor_id TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ticket_events_ticket_time
  ON ticket_events(guild_id, ticket_id, created_at DESC, id DESC);
CREATE INDEX idx_ticket_events_guild_time
  ON ticket_events(guild_id, created_at DESC);
