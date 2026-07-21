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
