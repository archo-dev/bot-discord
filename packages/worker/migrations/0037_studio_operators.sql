-- M12: developer Studio operators allowlist + granular permissions. Additive,
-- backend-owned, behind the platform.studio flag. This is the server-side source
-- of truth for dev-auth: a Discord user reaches the Studio ONLY if it is an
-- `active` operator here (or listed in the STUDIO_OWNER_IDS bootstrap secret).
-- Permissions are verified server-side on every /studio-api/* request via
-- requireDeveloper(permission) — never trusted from the client (doc 09).
--
-- No owner id is seeded here (no hard-coded snowflake in the DB): the first
-- operator (owner) comes from the STUDIO_OWNER_IDS secret, provisioned out of
-- band (doc 09 §3, E2 Fiche 7.1). Team management (add/remove operators, edit
-- permissions from /settings) lands in M13+. No destructive SQL.

CREATE TABLE studio_operators (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- Internal operator note, never exposed to the client surface.
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Granular permission grants (doc 09 §3 matrix — 13 permissions). Cumulative but
-- independent: grant_lifetime is NEVER implied by grant, refund_paid never by
-- cancel_paid. There is deliberately no `subscriptions.revoke_paid` permission.
CREATE TABLE studio_operator_permissions (
  user_id TEXT NOT NULL REFERENCES studio_operators(user_id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN (
    'subscriptions.read',
    'subscriptions.grant',
    'subscriptions.grant_lifetime',
    'subscriptions.revoke_granted',
    'subscriptions.cancel_paid',
    'subscriptions.refund_paid',
    'support.manage',
    'guilds.inspect',
    'features.manage',
    'updates.publish',
    'deployments.read',
    'deployments.manage',
    'audit.read'
  )),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by TEXT,
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX idx_studio_operator_permissions_user ON studio_operator_permissions(user_id);
