-- M05 reliable delivery. Additive idempotency ledger for at-least-once Gateway
-- events. Stores ONLY the business event id (a UUID, not a Discord id) + type +
-- timestamp — no payload, no Discord identifier, no private data. Bounded by a
-- short-retention purge (48 h) in the daily cron. Old Workers ignore this table.

CREATE TABLE processed_events (
  event_id     TEXT PRIMARY KEY,       -- envelope UUID (business dedup key, not the M02 nonce)
  event_type   TEXT NOT NULL,
  processed_at INTEGER NOT NULL        -- epoch ms, for purge
);

CREATE INDEX idx_processed_events_at ON processed_events(processed_at);
