-- M11: client support (tickets + messages). Additive, backend-owned.
-- Priority is DERIVED from the effective plan at open and FROZEN thereafter
-- (a later downgrade never deprioritizes; it's flagged instead). The client
-- never sets priority and never sees internal notes or the operator assignee —
-- those columns exist for the Studio (M12). No physical deletion (statuses only).

CREATE TABLE support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  -- Optional context label; no guild data is ever read/exposed from it.
  guild_id TEXT,
  plan_at_open TEXT NOT NULL CHECK (plan_at_open IN ('free', 'premium', 'business')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  -- Operator assignment — Studio (M12); never exposed to the client.
  assignee TEXT,
  plan_changed_since_open INTEGER NOT NULL DEFAULT 0 CHECK (plan_changed_since_open IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_support_tickets_user ON support_tickets(user_id, updated_at DESC);
-- Priority queue (Studio M12): highest priority first, oldest first at equal priority.
CREATE INDEX idx_support_tickets_queue ON support_tickets(status, priority, created_at);
CREATE INDEX idx_support_tickets_assignee ON support_tickets(assignee, status) WHERE assignee IS NOT NULL;

CREATE TABLE support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- 'user' | 'operator:<id>' | 'system'. The client only ever sees the coarse role.
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  -- Internal operator note (Studio M12) — NEVER returned to the client.
  internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_support_messages_ticket ON support_messages(ticket_id, created_at);
