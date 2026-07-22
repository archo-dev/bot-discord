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

// --- Webhook event state machine (fix/stripe-webhook-ordering) ---
// An event is only ever 'processed' once its business mutation actually
// succeeded. A recoverable dependency leaves it 'retryable_failed' so Stripe can
// redeliver. The claim is a single atomic statement so exactly one attempt
// processes an event at a time (others get 'in_progress'/'duplicate'/'terminal').

export type WebhookClaimDecision = "claimed" | "duplicate" | "in_progress" | "terminal";

/** Reclaim window: a 'processing' row left by a crashed attempt is reclaimable. */
const WEBHOOK_STALE_MS = 120_000;

/**
 * Atomically claim an event for processing. A brand-new event, a
 * 'retryable_failed' one, or a stale 'processing' one is claimed → 'processing'.
 * An already 'processed' event → duplicate; a fresh in-flight one → in_progress;
 * a 'terminal_failed' one → terminal. Returns the (incremented) attempt count.
 */
export async function claimWebhookEvent(
  db: D1Database,
  eventId: string,
  eventType: string,
  nowMs: number,
  staleMs: number = WEBHOOK_STALE_MS,
): Promise<{ decision: WebhookClaimDecision; attempts: number }> {
  const claimed = await db
    .prepare(
      `INSERT INTO billing_webhook_events (event_id, event_type, status, attempts, processed_at, updated_at)
         VALUES (?1, ?2, 'processing', 1, ?3, ?3)
       ON CONFLICT(event_id) DO UPDATE SET
         status = 'processing',
         attempts = billing_webhook_events.attempts + 1,
         updated_at = ?3
       WHERE billing_webhook_events.status IN ('received', 'retryable_failed')
          OR (billing_webhook_events.status = 'processing' AND billing_webhook_events.updated_at < ?4)
       RETURNING attempts`,
    )
    .bind(eventId, eventType, nowMs, nowMs - staleMs)
    .first<{ attempts: number }>();
  if (claimed) return { decision: "claimed", attempts: claimed.attempts };

  const row = await db
    .prepare(`SELECT status, attempts FROM billing_webhook_events WHERE event_id = ?1`)
    .bind(eventId)
    .first<{ status: string; attempts: number }>();
  const attempts = row?.attempts ?? 0;
  if (row?.status === "processed") return { decision: "duplicate", attempts };
  if (row?.status === "terminal_failed") return { decision: "terminal", attempts };
  return { decision: "in_progress", attempts }; // 'processing' held by another attempt, not yet stale
}

/** Statement that flips a claimed event to 'processed' (batched atomically with its audit). */
export function webhookProcessedStatement(db: D1Database, eventId: string, nowMs: number): D1PreparedStatement {
  return db
    .prepare(`UPDATE billing_webhook_events SET status = 'processed', processed_at = ?2, updated_at = ?2 WHERE event_id = ?1`)
    .bind(eventId, nowMs);
}

/** Mark a claimed event as recoverable → a future delivery reclaims it. */
export async function markWebhookEventRetryable(db: D1Database, eventId: string, nowMs: number): Promise<void> {
  await db
    .prepare(`UPDATE billing_webhook_events SET status = 'retryable_failed', updated_at = ?2 WHERE event_id = ?1`)
    .bind(eventId, nowMs)
    .run();
}

/** Give up on an event after too many attempts (stop retries; never reprocessed). */
export async function markWebhookEventTerminal(db: D1Database, eventId: string, nowMs: number): Promise<void> {
  await db
    .prepare(`UPDATE billing_webhook_events SET status = 'terminal_failed', processed_at = ?2, updated_at = ?2 WHERE event_id = ?1`)
    .bind(eventId, nowMs)
    .run();
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

/** Prepared statement for the audit journal insert (append-only, invariant 5).
 *  Exposed so the webhook can batch it atomically with the 'processed' flip —
 *  guaranteeing the audit row and the terminal state commit together (exactly once). */
export function subscriptionEventStatement(db: D1Database, input: SubscriptionEventInput): D1PreparedStatement {
  return db
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
    );
}

/** Append-only entitlement/subscription transition journal (audit, invariant 5). */
export async function insertSubscriptionEvent(db: D1Database, input: SubscriptionEventInput): Promise<void> {
  await subscriptionEventStatement(db, input).run();
}
