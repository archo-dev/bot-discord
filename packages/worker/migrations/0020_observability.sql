-- M01 observability: bounded hourly aggregates only. No raw request, Discord
-- content, user/channel identifier, IP, URL, token or error message is stored.
-- guild_key is a deployment-specific SHA-256 pseudonym derived by the Worker.

CREATE TABLE operation_metrics (
  guild_key       TEXT NOT NULL,
  bucket          TEXT NOT NULL, -- UTC YYYY-MM-DDTHH:00:00Z
  module          TEXT NOT NULL CHECK (module IN (
    'core','auth','interactions','commands','moderation','tickets','roles',
    'welcome','automod','levels','starboard','temp_voice','music','voice_logs',
    'stats','gateway','cron'
  )),
  operation       TEXT NOT NULL CHECK (operation IN (
    'read','write','interaction','internal','heartbeat','discord_rest','scheduled'
  )),
  outcome         TEXT NOT NULL CHECK (outcome IN ('success','error')),
  event_count     INTEGER NOT NULL DEFAULT 0,
  sample_count    INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  latency_sum_ms  INTEGER NOT NULL DEFAULT 0,
  latency_max_ms  INTEGER NOT NULL DEFAULT 0,
  latency_le_100  INTEGER NOT NULL DEFAULT 0,
  latency_le_250  INTEGER NOT NULL DEFAULT 0,
  latency_le_500  INTEGER NOT NULL DEFAULT 0,
  latency_le_1000 INTEGER NOT NULL DEFAULT 0,
  latency_le_2500 INTEGER NOT NULL DEFAULT 0,
  latency_le_5000 INTEGER NOT NULL DEFAULT 0,
  latency_gt_5000 INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_key, bucket, module, operation, outcome)
);

CREATE INDEX idx_operation_metrics_guild_bucket
  ON operation_metrics (guild_key, bucket DESC);
