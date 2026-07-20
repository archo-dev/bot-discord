-- M6: entitlements core (access rights), behind the platform.entitlements flag.
-- Additive and backend-owned. Separates access (entitlements) from payment
-- (billing, added in M9). Revocability is NEVER stored: it derives from
-- `source` (revocable = source != 'paid'). The effective plan is resolved in
-- code (@bot/shared resolveEffectiveEntitlement), never trusted from the client.
--
-- Scope M6: plans (seeded) + entitlements + assignment/event tables as schema
-- groundwork. Slot assignment/gating write paths land in M7; event/origin write
-- paths (billing, grants) land in M9/M13. No origin tables here: entitlements
-- .origin_ref is a logical, source-discriminated reference (doc 08).

-- Plan catalog (referential, tiny). Stable ids per platform-split README §4.
CREATE TABLE plans (
  id TEXT PRIMARY KEY CHECK (id IN ('free', 'premium', 'business')),
  rank INTEGER NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  slots INTEGER NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO plans (id, rank, display_name, slots) VALUES
  ('free', 1, 'Gratuit', 1),
  ('premium', 2, 'Premium', 3),
  ('business', 3, 'Business', 5);

-- A user's access right to a plan, with an origin and a validity window.
CREATE TABLE entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  source TEXT NOT NULL CHECK (source IN ('paid', 'granted', 'trial', 'promotion', 'partner')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked', 'cancelled', 'suspended', 'past_due')),
  start_at TEXT NOT NULL DEFAULT (datetime('now')),
  end_at TEXT,
  is_lifetime INTEGER NOT NULL DEFAULT 0 CHECK (is_lifetime IN (0, 1)),
  -- Logical FK, discriminated by `source` (billing_subscriptions/developer_grants/
  -- trials/promotion_redemptions/partners). Not materialized in M6.
  origin_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Lifetime => no end; otherwise an end is required.
  CHECK ((is_lifetime = 1 AND end_at IS NULL) OR (is_lifetime = 0 AND end_at IS NOT NULL))
);

CREATE INDEX idx_entitlements_user_status ON entitlements(user_id, status);
CREATE INDEX idx_entitlements_status_end ON entitlements(status, end_at);
CREATE INDEX idx_entitlements_plan ON entitlements(plan_id);

-- Which guild consumes an entitlement slot. Schema only in M6; the assignment
-- and downgrade/suspension write paths land in M7.
CREATE TABLE entitlement_guild_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entitlement_id INTEGER NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_by TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'suspended')),
  last_reassigned_at TEXT,
  released_at TEXT
);

CREATE INDEX idx_entitlement_assignments_entitlement_state
  ON entitlement_guild_assignments(entitlement_id, state);
-- An active guild belongs to at most one entitlement at a time.
CREATE UNIQUE INDEX idx_entitlement_assignments_active_guild
  ON entitlement_guild_assignments(guild_id) WHERE state = 'active';

-- Append-only journal of entitlement/subscription transitions. Write paths land
-- with the mutations that produce them (M9/M10/M13). No UPDATE/DELETE route.
CREATE TABLE subscription_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entitlement_id INTEGER REFERENCES entitlements(id) ON DELETE SET NULL,
  billing_subscription_id TEXT,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_subscription_events_entitlement_time
  ON subscription_events(entitlement_id, created_at DESC);
CREATE INDEX idx_subscription_events_type_time
  ON subscription_events(type, created_at DESC);
