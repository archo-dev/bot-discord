-- fix/stripe-webhook-ordering: webhook event state machine.
--
-- ROOT CAUSE: billing_webhook_events (0035) recorded an event by id BEFORE the
-- business mutation ran and returned 200 even when that mutation was a no-op
-- (dependency not ready). So a `customer.subscription.created` delivered BEFORE
-- `checkout.session.completed` (Stripe does not guarantee order) found no mapped
-- customer, no-op'd, was marked "seen", and its 200 told Stripe never to retry —
-- the paid entitlement was lost permanently, unrecoverable even on resend (the
-- event id was already deduplicated).
--
-- FIX: an explicit status. An event is claimed as 'processing', and only becomes
-- 'processed' AFTER the mutation actually succeeds. A recoverable dependency
-- (customer not yet mapped, price/plan not yet resolvable) leaves the event
-- 'retryable_failed' and the route returns a retryable 503 so Stripe redelivers;
-- a later attempt (after the dependency is satisfied) reclaims and completes it.
--
-- Additive (ALTER ... ADD COLUMN). Applied to STAGING/LOCAL only for now — NOT
-- production (remote prod migration deferred, like 0032-0039).

ALTER TABLE billing_webhook_events ADD COLUMN status TEXT NOT NULL DEFAULT 'processed'
  CHECK (status IN ('received', 'processing', 'processed', 'retryable_failed', 'terminal_failed'));

-- Delivery attempts (bounds retries → 'terminal_failed' after a cap).
ALTER TABLE billing_webhook_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;

-- Last state transition (epoch ms) — used to reclaim a stale 'processing' row
-- left by a crashed attempt.
ALTER TABLE billing_webhook_events ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

-- Existing rows keep the historical default 'processed' (already handled once).
CREATE INDEX idx_billing_webhook_events_status ON billing_webhook_events(status, updated_at);
