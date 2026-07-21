-- M13: manually-granted access metadata (developer_grants). Additive, Studio-owned,
-- behind platform.studio. Origin table for entitlements of source='granted' — the
-- operator gesture behind a granted access (doc 08). Each grant creates ONE
-- entitlements row (source='granted') + ONE developer_grants row; entitlements
-- .origin_ref points back to this grant id (invariant 7).
--
-- Revocability derives from entitlements.source, never stored here: revoking a
-- granted access sets entitlements.status='revoked' (guarded so a `paid` can
-- NEVER be revoked via this path — invariant 6 / doc 06). Lifetime requires the
-- distinct `subscriptions.grant_lifetime` permission + explicit LIFETIME typing +
-- audit (verified in the API layer, doc 09). Only `granted` may be lifetime.
-- No destructive SQL. partner/promotion/trial origin tables are deferred.

CREATE TABLE developer_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entitlement_id INTEGER NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
  -- Operator (Discord snowflake) who created the grant. NOT NULL: every grant is
  -- attributable.
  granted_by TEXT NOT NULL,
  -- Mandatory justification (doc 06/08). NOT NULL by design.
  reason TEXT NOT NULL,
  -- Internal note — NEVER exposed to the client surface.
  internal_note TEXT,
  duration_kind TEXT NOT NULL
    CHECK (duration_kind IN ('7d', '30d', '3m', '6m', '1y', 'custom', 'lifetime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Revocation trail (revoke never deletes: entitlement stays as status='revoked').
  revoked_by TEXT,
  revoked_at TEXT,
  revoke_reason TEXT
);

CREATE INDEX idx_developer_grants_entitlement ON developer_grants(entitlement_id);
CREATE INDEX idx_developer_grants_granted_by ON developer_grants(granted_by);
