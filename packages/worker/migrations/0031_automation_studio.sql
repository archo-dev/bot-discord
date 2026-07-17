-- M10 — Automation Studio. Additive, guild-scoped and safe to leave in place on rollback.

-- The historical guild_modules table has a closed CHECK constraint. Keep it
-- untouched and extend the same governance model additively for post-M09 modules.
CREATE TABLE guild_module_extensions (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL CHECK (module_id IN ('automations')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  authority TEXT NOT NULL DEFAULT 'governance' CHECK (authority IN ('legacy', 'governance')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, module_id)
);

CREATE INDEX idx_guild_module_extensions_enabled
  ON guild_module_extensions(guild_id, enabled, module_id);

INSERT INTO guild_module_extensions (guild_id, module_id, enabled, authority)
SELECT id, 'automations', 0, 'governance' FROM guilds;

-- Versioned audit storage: the v1 table also has closed CHECK constraints.
-- Existing rows are copied; compatible mutations remain dual-written during M10.
CREATE TABLE admin_audit_log_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_access TEXT NOT NULL CHECK (actor_access IN ('manage_guild','panel_admin','panel_moderator')),
  capability TEXT NOT NULL CHECK (capability IN (
    'guild_config_write','guild_identity_write','panel_access_manage','roles_write','roles_publish',
    'moderation_write','commands_write','music_control','tickets_write','automations_write'
  )),
  method TEXT NOT NULL CHECK (method IN ('POST','PUT','PATCH','DELETE')),
  target_type TEXT CHECK (target_type IS NULL OR target_type IN ('command','warning','button_role','automation')),
  target_id TEXT CHECK (target_id IS NULL OR length(target_id) <= 64),
  outcome TEXT NOT NULL CHECK (outcome IN ('success','error')),
  status INTEGER NOT NULL CHECK (status BETWEEN 200 AND 599),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 64),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO admin_audit_log_v2
  (id,guild_id,actor_id,actor_access,capability,method,target_type,target_id,outcome,status,request_id,created_at)
SELECT id,guild_id,actor_id,actor_access,capability,method,target_type,target_id,outcome,status,request_id,created_at
FROM admin_audit_log;

CREATE INDEX idx_admin_audit_v2_guild_created ON admin_audit_log_v2(guild_id, created_at DESC, id DESC);
CREATE INDEX idx_admin_audit_v2_created ON admin_audit_log_v2(created_at);

CREATE TABLE automation_workflows (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL DEFAULT '{}',
  conditions TEXT NOT NULL DEFAULT '[]',
  condition_mode TEXT NOT NULL DEFAULT 'all' CHECK (condition_mode IN ('all', 'any')),
  actions TEXT NOT NULL DEFAULT '[]',
  cooldown_seconds INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_seconds BETWEEN 0 AND 86400),
  cooldown_scope TEXT NOT NULL DEFAULT 'user' CHECK (cooldown_scope IN ('user', 'guild', 'channel')),
  max_runs_per_minute INTEGER NOT NULL DEFAULT 10 CHECK (max_runs_per_minute BETWEEN 1 AND 60),
  revision INTEGER NOT NULL DEFAULT 1,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  circuit_open_until TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guild_id, name)
);

CREATE INDEX idx_automation_workflows_trigger
  ON automation_workflows(guild_id, trigger_type, enabled);
CREATE INDEX idx_automation_workflows_updated
  ON automation_workflows(guild_id, updated_at DESC);

CREATE TABLE automation_workflow_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('create', 'update', 'enable', 'disable', 'duplicate', 'import', 'delete')),
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workflow_id, revision)
);

CREATE INDEX idx_automation_revisions_workflow
  ON automation_workflow_revisions(guild_id, workflow_id, revision DESC);

CREATE TABLE automation_event_queue (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  context TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 8),
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  lease_until INTEGER,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_automation_queue_due
  ON automation_event_queue(status, available_at, lease_until);
CREATE INDEX idx_automation_queue_guild_trigger
  ON automation_event_queue(guild_id, trigger_type, status);

CREATE TABLE automation_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped', 'simulated')),
  actions_total INTEGER NOT NULL DEFAULT 0,
  actions_succeeded INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_code TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  UNIQUE (workflow_id, event_id)
);

CREATE INDEX idx_automation_executions_recent
  ON automation_executions(guild_id, started_at DESC, id DESC);
CREATE INDEX idx_automation_executions_workflow
  ON automation_executions(guild_id, workflow_id, started_at DESC);
CREATE INDEX idx_automation_executions_cooldown
  ON automation_executions(workflow_id, scope_key, started_at DESC);

CREATE TABLE automation_action_runs (
  execution_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_code TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  PRIMARY KEY (execution_id, position)
);

CREATE TABLE automation_stats_daily (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL,
  day TEXT NOT NULL,
  executions INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  duration_ms_total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, workflow_id, day)
);

CREATE INDEX idx_automation_stats_day ON automation_stats_daily(day);

CREATE TABLE automation_rate_limits (
  workflow_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER NOT NULL,
  PRIMARY KEY (workflow_id, scope_key, bucket)
);

CREATE INDEX idx_automation_rate_limits_time ON automation_rate_limits(last_run_at);

CREATE TABLE automation_scheduled_tasks (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  payload TEXT NOT NULL DEFAULT '{}',
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (workflow_id, run_at)
);

CREATE INDEX idx_automation_tasks_due
  ON automation_scheduled_tasks(status, run_at, lease_until);

CREATE TABLE automation_event_suppressions (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, trigger_type, scope_key)
);

CREATE INDEX idx_automation_suppressions_expiry ON automation_event_suppressions(expires_at);
