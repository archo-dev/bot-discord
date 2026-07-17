-- M08: bounded, privacy-preserving product analytics.
-- Raw Discord/user/content identifiers are deliberately absent from metric tables.

CREATE TABLE guild_privacy (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  product_analytics_enabled INTEGER NOT NULL DEFAULT 1 CHECK (product_analytics_enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_metric_contributions (
  day TEXT NOT NULL,
  guild_key TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('guild_installed','onboarding_step','onboarding_completed','module_activation_changed','feature_result','guild_uninstalled')),
  module TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','enabled','disabled','completed','dismissed')),
  app_version TEXT NOT NULL,
  cohort_bucket INTEGER NOT NULL CHECK (cohort_bucket BETWEEN 0 AND 15),
  count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, guild_key, event, module, step, outcome, app_version)
);

CREATE INDEX idx_product_metric_contributions_day ON product_metric_contributions(day);

CREATE TABLE product_metrics (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  app_version TEXT NOT NULL,
  cohort_bucket INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  guild_count INTEGER NOT NULL CHECK (guild_count > 0),
  PRIMARY KEY (day, event, module, step, outcome, app_version, cohort_bucket)
);

CREATE TABLE product_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('onboarding','module','problem','idea','uninstall','other')),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_product_feedback_created ON product_feedback(created_at);
