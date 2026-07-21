-- M14: immutable studio audit journal. Additive, Studio-owned, behind
-- platform.studio. Distinct from admin_audit_log(_v2) (panel/guild-scoped): this
-- is the cross-guild operator audit for sensitive Studio mutations — grants,
-- lifetime, revocations, publications, and later flags/permissions (doc 08/09).
--
-- APPEND-ONLY by design: there is deliberately NO UPDATE/DELETE route and no
-- retention purge (long retention, doc 08). metadata_json is written with
-- secrets/PII masked; ip_hash is an HMAC, never the raw IP (doc 09 §8/9).
-- No destructive SQL.

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'operator:<snowflake>' or 'system'.
  actor TEXT NOT NULL,
  -- The permission/action performed, e.g. 'subscriptions.grant_lifetime'.
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  -- Contextual metadata with secrets/PII masked (never raw email/token/ip).
  metadata_json TEXT,
  -- HMAC of the caller IP (never the raw address).
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_events_actor ON audit_events(actor, created_at DESC);
CREATE INDEX idx_audit_events_action ON audit_events(action, created_at DESC);
CREATE INDEX idx_audit_events_target ON audit_events(target_type, target_id);
