-- M10: idempotency store for verified Stripe webhook events. Additive.
-- Same pattern as processed_events (0023) / internal_request_nonces (0021):
-- a verified event is recorded by its provider event id; a replay finds the row
-- and is a no-op. Billing-scoped (separate from the gateway delivery table) so
-- retention/audit stay isolated. Mutations driven by these events are also
-- individually idempotent (upserts), so a partial-failure retry is safe.

CREATE TABLE billing_webhook_events (
  event_id     TEXT PRIMARY KEY,   -- provider event id (e.g. Stripe "evt_...")
  event_type   TEXT NOT NULL,
  processed_at INTEGER NOT NULL    -- epoch ms, for retention purge
);

CREATE INDEX idx_billing_webhook_events_at ON billing_webhook_events(processed_at);
