/** Verified Stripe webhook pipeline (M10): the ONLY path that creates or mutates
 * a paid entitlement. Signature → billing flag (kill-switch) → idempotency →
 * lifecycle. All mutations are idempotent upserts; a replay is a no-op. A paid
 * entitlement is never revoked (invariant 6). Every transition is journaled in
 * subscription_events (invariant 5). No frontend/`success=true` is ever trusted. */

import { mapProviderStatusToEntitlementStatus, type BillingInterval, type PlanId } from "@bot/shared";
import type { Env } from "../env.js";
import { getWorkerFlags } from "../config/flags.js";
import { resolvePlanFromPriceId } from "./index.js";
import {
  normalizeStripeSubStatus,
  parseStripeEvent,
  verifyStripeSignature,
  type StripeEvent,
} from "./stripe-webhook.js";
import {
  getBillingCustomerByProviderId,
  getEntitlementById,
  getSubscriptionByProviderId,
  insertEntitlement,
  insertSubscriptionEvent,
  recordWebhookEvent,
  setSubscriptionEntitlement,
  updatePaidEntitlement,
  upsertBillingCustomer,
  upsertBillingSubscription,
} from "../db/queries.js";

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

function str(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}
function num(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}

function firstPriceId(obj: Record<string, unknown>): string | null {
  const items = obj["items"];
  const data = items && typeof items === "object" ? (items as { data?: unknown }).data : undefined;
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    const price = (data[0] as { price?: unknown }).price;
    if (typeof price === "string") return price;
    if (price && typeof price === "object" && typeof (price as { id?: unknown }).id === "string") {
      return (price as { id: string }).id;
    }
  }
  return null;
}

function extractEmail(obj: Record<string, unknown>): string | null {
  const direct = str(obj, "customer_email");
  if (direct) return direct;
  const details = obj["customer_details"];
  if (details && typeof details === "object") return str(details as Record<string, unknown>, "email");
  return null;
}

function epochSecToIso(sec: number | null, fallbackMs: number): string {
  return sec ? new Date(sec * 1000).toISOString() : new Date(fallbackMs).toISOString();
}

/** Map customer → Discord user, so a paid entitlement is only ever attached to
 *  the user identified by the checkout's client_reference_id. */
async function handleCheckoutCompleted(db: D1Database, obj: Record<string, unknown>): Promise<void> {
  const userId = str(obj, "client_reference_id");
  const customerId = str(obj, "customer");
  if (!userId || !customerId) return;
  await upsertBillingCustomer(db, {
    userId,
    provider: "stripe",
    providerCustomerId: customerId,
    email: extractEmail(obj),
  });
}

/** Sync a subscription + create/update its paid entitlement (idempotent). */
async function handleSubscriptionUpsert(db: D1Database, env: Env, obj: Record<string, unknown>, nowMs: number): Promise<void> {
  const providerSubId = str(obj, "id");
  const customerId = str(obj, "customer");
  const status = str(obj, "status");
  if (!providerSubId || !customerId || !status) return;

  const customer = await getBillingCustomerByProviderId(db, "stripe", customerId);
  if (!customer) return; // customer not mapped yet (checkout not processed) → no-op

  const priceId = firstPriceId(obj);
  const plan = priceId ? resolvePlanFromPriceId(env, priceId) : null;
  if (!plan) return; // unknown price → cannot determine plan → no-op

  const billingStatus = normalizeStripeSubStatus(status);
  const endAtIso = epochSecToIso(num(obj, "current_period_end"), nowMs);
  const cancelAtPeriodEnd = obj["cancel_at_period_end"] === true;

  const existing = await getSubscriptionByProviderId(db, "stripe", providerSubId);
  const subId = await upsertBillingSubscription(db, {
    customerId: customer.id,
    provider: "stripe",
    providerSubscriptionId: providerSubId,
    planId: plan.planId,
    status: billingStatus,
    interval: plan.interval,
    currentPeriodEnd: endAtIso,
    cancelAtPeriodEnd,
    entitlementId: existing?.entitlement_id ?? null,
  });

  const entStatus = mapProviderStatusToEntitlementStatus(billingStatus);
  const linkedId = (await getSubscriptionByProviderId(db, "stripe", providerSubId))?.entitlement_id ?? null;

  let entitlementId: number;
  let fromStatus: string | null = null;
  if (linkedId) {
    const ent = await getEntitlementById(db, linkedId);
    fromStatus = ent?.status ?? null;
    if (ent && ent.source === "paid") await updatePaidEntitlement(db, linkedId, plan.planId, entStatus, endAtIso);
    entitlementId = linkedId;
  } else {
    entitlementId = await insertEntitlement(db, {
      userId: customer.user_id,
      planId: plan.planId,
      source: "paid",
      status: entStatus,
      // Explicit ISO start (never the SQLite space-format datetime('now')): the
      // pure resolver parses ISO reliably regardless of server timezone.
      startAt: new Date(nowMs).toISOString(),
      endAt: endAtIso,
      originRef: String(subId),
    });
    await setSubscriptionEntitlement(db, subId, entitlementId);
  }

  await insertSubscriptionEvent(db, {
    entitlementId,
    billingSubscriptionId: subId,
    type: `subscription.${billingStatus}`,
    fromStatus,
    toStatus: entStatus,
    actor: "webhook",
    payload: { providerSubId, plan: plan.planId, interval: plan.interval },
  });
}

/** Subscription ended: expire the mirror + the paid entitlement (never revoked). */
async function handleSubscriptionDeleted(db: D1Database, obj: Record<string, unknown>, nowMs: number): Promise<void> {
  const providerSubId = str(obj, "id");
  if (!providerSubId) return;
  const subRow = await getSubscriptionByProviderId(db, "stripe", providerSubId);
  if (!subRow) return;

  await upsertBillingSubscription(db, {
    customerId: subRow.customer_id,
    provider: "stripe",
    providerSubscriptionId: providerSubId,
    planId: subRow.plan_id as PlanId,
    status: "expired",
    interval: subRow.interval as BillingInterval,
    currentPeriodEnd: subRow.current_period_end,
    cancelAtPeriodEnd: subRow.cancel_at_period_end === 1,
    entitlementId: subRow.entitlement_id,
  });

  if (subRow.entitlement_id !== null) {
    const ent = await getEntitlementById(db, subRow.entitlement_id);
    const endAt = subRow.current_period_end ?? new Date(nowMs).toISOString();
    if (ent && ent.source === "paid") await updatePaidEntitlement(db, subRow.entitlement_id, ent.plan_id as PlanId, "expired", endAt);
    await insertSubscriptionEvent(db, {
      entitlementId: subRow.entitlement_id,
      billingSubscriptionId: subRow.id,
      type: "subscription.expired",
      fromStatus: ent?.status ?? null,
      toStatus: "expired",
      actor: "webhook",
      payload: { providerSubId },
    });
  }
}

async function processEvent(db: D1Database, env: Env, event: StripeEvent, nowMs: number): Promise<void> {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(db, obj);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpsert(db, env, obj, nowMs);
      return;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(db, obj, nowMs);
      return;
    default:
      return; // unhandled type → no-op (still deduplicated)
  }
}

/**
 * Full webhook pipeline. Returns the HTTP status/body for the route. Only a
 * verified event, with the billing flag on, reaches the mutations — and each is
 * idempotent, so replays are safe no-ops.
 */
export async function handleStripeWebhook(
  db: D1Database,
  env: Env,
  rawBody: string,
  sigHeader: string | undefined | null,
  nowMs: number,
): Promise<WebhookResult> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { status: 503, body: { error: "webhook_not_configured" } };
  if (!(await verifyStripeSignature(rawBody, sigHeader, secret, nowMs))) {
    return { status: 400, body: { error: "invalid_signature" } };
  }
  const event = parseStripeEvent(rawBody);
  if (!event) return { status: 400, body: { error: "invalid_payload" } };

  // Kill-switch: with billing off, acknowledge without mutating (no retries).
  if (!getWorkerFlags(env)["platform.billing"]) return { status: 200, body: { received: true, ignored: true } };

  // Idempotency: a replayed event id is a no-op.
  if (!(await recordWebhookEvent(db, event.id, event.type, nowMs))) {
    return { status: 200, body: { received: true, duplicate: true } };
  }

  await processEvent(db, env, event, nowMs);
  return { status: 200, body: { received: true } };
}
