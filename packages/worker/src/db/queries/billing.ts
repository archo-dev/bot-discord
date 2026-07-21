/** Billing storage (M9, sandbox). Raw SQL only. Mirrors the provider's
 * customer/subscription; decoupled from entitlements. No public flow writes
 * these in M9 — insert helpers exist for tests and the M10 webhook. The paid
 * entitlement is never created here. */

import type { BillingInterval, BillingProvider, BillingSubscriptionStatus, PlanId } from "@bot/shared";

export interface BillingCustomerRow {
  id: number;
  user_id: string;
  provider: string;
  provider_customer_id: string;
  email: string | null;
  created_at: string;
}

export interface BillingSubscriptionRow {
  id: number;
  customer_id: number;
  provider: string;
  provider_subscription_id: string;
  plan_id: string;
  status: string;
  interval: string;
  current_period_end: string | null;
  cancel_at_period_end: number;
  entitlement_id: number | null;
  created_at: string;
  updated_at: string;
}

/** The user's billing customer (at most one per provider is used in M9). */
export async function getBillingCustomerByUser(
  db: D1Database,
  userId: string,
): Promise<BillingCustomerRow | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, provider, provider_customer_id, email, created_at
         FROM billing_customers WHERE user_id = ?1
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(userId)
    .first<BillingCustomerRow>();
  return row ?? null;
}

/** The user's most relevant subscription (newest), or null. */
export async function getSubscriptionByUser(
  db: D1Database,
  userId: string,
): Promise<BillingSubscriptionRow | null> {
  const row = await db
    .prepare(
      `SELECT s.id, s.customer_id, s.provider, s.provider_subscription_id, s.plan_id, s.status,
              s.interval, s.current_period_end, s.cancel_at_period_end, s.entitlement_id,
              s.created_at, s.updated_at
         FROM billing_subscriptions s
         JOIN billing_customers c ON c.id = s.customer_id
        WHERE c.user_id = ?1
        ORDER BY s.id DESC LIMIT 1`,
    )
    .bind(userId)
    .first<BillingSubscriptionRow>();
  return row ?? null;
}

// --- Insert helpers (tests + M10 webhook; not exposed via any public mutation) ---

export interface InsertBillingCustomerInput {
  userId: string;
  provider: BillingProvider;
  providerCustomerId: string;
  email?: string | null;
}

export async function insertBillingCustomer(db: D1Database, input: InsertBillingCustomerInput): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO billing_customers (user_id, provider, provider_customer_id, email)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(input.userId, input.provider, input.providerCustomerId, input.email ?? null)
    .run();
  return Number(res.meta.last_row_id);
}

export interface InsertBillingSubscriptionInput {
  customerId: number;
  provider: BillingProvider;
  providerSubscriptionId: string;
  planId: PlanId;
  status: BillingSubscriptionStatus;
  interval: BillingInterval;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  entitlementId?: number | null;
}

export async function insertBillingSubscription(db: D1Database, input: InsertBillingSubscriptionInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO billing_subscriptions
         (customer_id, provider, provider_subscription_id, plan_id, status, interval,
          current_period_end, cancel_at_period_end, entitlement_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      input.customerId,
      input.provider,
      input.providerSubscriptionId,
      input.planId,
      input.status,
      input.interval,
      input.currentPeriodEnd ?? null,
      input.cancelAtPeriodEnd ? 1 : 0,
      input.entitlementId ?? null,
    )
    .run();
}

// --- Webhook sync helpers (M10). Only verified webhook events reach these. ---

export async function getBillingCustomerByProviderId(
  db: D1Database,
  provider: BillingProvider,
  providerCustomerId: string,
): Promise<BillingCustomerRow | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, provider, provider_customer_id, email, created_at
         FROM billing_customers WHERE provider = ?1 AND provider_customer_id = ?2 LIMIT 1`,
    )
    .bind(provider, providerCustomerId)
    .first<BillingCustomerRow>();
  return row ?? null;
}

/** Idempotent upsert of a billing customer (by provider identity). Returns its id. */
export async function upsertBillingCustomer(db: D1Database, input: InsertBillingCustomerInput): Promise<number> {
  await db
    .prepare(
      `INSERT INTO billing_customers (user_id, provider, provider_customer_id, email)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(provider, provider_customer_id)
       DO UPDATE SET user_id = excluded.user_id, email = COALESCE(excluded.email, billing_customers.email)`,
    )
    .bind(input.userId, input.provider, input.providerCustomerId, input.email ?? null)
    .run();
  const row = await getBillingCustomerByProviderId(db, input.provider, input.providerCustomerId);
  return row!.id;
}

export async function getSubscriptionByProviderId(
  db: D1Database,
  provider: BillingProvider,
  providerSubscriptionId: string,
): Promise<BillingSubscriptionRow | null> {
  const row = await db
    .prepare(
      `SELECT id, customer_id, provider, provider_subscription_id, plan_id, status, interval,
              current_period_end, cancel_at_period_end, entitlement_id, created_at, updated_at
         FROM billing_subscriptions WHERE provider = ?1 AND provider_subscription_id = ?2 LIMIT 1`,
    )
    .bind(provider, providerSubscriptionId)
    .first<BillingSubscriptionRow>();
  return row ?? null;
}

/** Idempotent upsert of a subscription mirror (by provider identity). Returns its id.
 *  Never overwrites an existing entitlement link with null. */
export async function upsertBillingSubscription(db: D1Database, input: InsertBillingSubscriptionInput): Promise<number> {
  await db
    .prepare(
      `INSERT INTO billing_subscriptions
         (customer_id, provider, provider_subscription_id, plan_id, status, interval,
          current_period_end, cancel_at_period_end, entitlement_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
         customer_id = excluded.customer_id,
         plan_id = excluded.plan_id,
         status = excluded.status,
         interval = excluded.interval,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         entitlement_id = COALESCE(billing_subscriptions.entitlement_id, excluded.entitlement_id),
         updated_at = datetime('now')`,
    )
    .bind(
      input.customerId,
      input.provider,
      input.providerSubscriptionId,
      input.planId,
      input.status,
      input.interval,
      input.currentPeriodEnd ?? null,
      input.cancelAtPeriodEnd ? 1 : 0,
      input.entitlementId ?? null,
    )
    .run();
  const row = await getSubscriptionByProviderId(db, input.provider, input.providerSubscriptionId);
  return row!.id;
}

export async function setSubscriptionEntitlement(db: D1Database, subscriptionId: number, entitlementId: number): Promise<void> {
  await db
    .prepare(`UPDATE billing_subscriptions SET entitlement_id = ?2, updated_at = datetime('now') WHERE id = ?1`)
    .bind(subscriptionId, entitlementId)
    .run();
}

/** Record a verified webhook event for idempotency. Returns true if new (first time). */
export async function recordWebhookEvent(db: D1Database, eventId: string, eventType: string, nowMs: number): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO billing_webhook_events (event_id, event_type, processed_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(event_id) DO NOTHING`,
    )
    .bind(eventId, eventType, nowMs)
    .run();
  return (res.meta.changes ?? 0) === 1;
}

export interface SubscriptionEventInput {
  entitlementId?: number | null;
  billingSubscriptionId?: number | null;
  type: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor: string;
  payload?: unknown;
}

/** Append-only entitlement/subscription transition journal (audit, invariant 5). */
export async function insertSubscriptionEvent(db: D1Database, input: SubscriptionEventInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subscription_events
         (entitlement_id, billing_subscription_id, type, from_status, to_status, actor, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      input.entitlementId ?? null,
      input.billingSubscriptionId ?? null,
      input.type,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.actor,
      input.payload === undefined ? null : JSON.stringify(input.payload),
    )
    .run();
}
