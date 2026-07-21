-- M9: billing sandbox storage (Stripe test mode). Additive, backend-owned.
-- Mirrors the provider's customer/subscription; DECOUPLED from entitlements
-- (a `provider` column enables anti-lock-in and later migration). The paid
-- entitlement itself is NEVER created here — its source of truth is the signed
-- webhook (M10). M9 only ships the tables + read/checkout surface; no public
-- flow writes these rows yet (helpers exist for tests and the M10 webhook).

CREATE TABLE billing_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'lemonsqueezy', 'paddle')),
  provider_customer_id TEXT NOT NULL,
  -- PII (from the provider): access-restricted, never exposed to other users.
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_customer_id)
);

CREATE INDEX idx_billing_customers_user ON billing_customers(user_id);

CREATE TABLE billing_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES billing_customers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'lemonsqueezy', 'paddle')),
  provider_subscription_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'cancelled', 'expired')),
  interval TEXT NOT NULL CHECK (interval IN ('month', 'year')),
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  -- Linked to the paid entitlement by the webhook (M10); nullable until then.
  entitlement_id INTEGER REFERENCES entitlements(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX idx_billing_subscriptions_entitlement ON billing_subscriptions(entitlement_id);
CREATE INDEX idx_billing_subscriptions_status ON billing_subscriptions(status);
CREATE INDEX idx_billing_subscriptions_period_end ON billing_subscriptions(current_period_end);
