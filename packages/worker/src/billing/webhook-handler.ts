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
  claimWebhookEvent,
  getBillingCustomerByProviderId,
  getEntitlementById,
  getSubscriptionByProviderId,
  insertEntitlement,
  markWebhookEventRetryable,
  markWebhookEventTerminal,
  setSubscriptionEntitlement,
  subscriptionEventStatement,
  updatePaidEntitlement,
  upsertBillingCustomer,
  upsertBillingSubscription,
  webhookProcessedStatement,
  type SubscriptionEventInput,
} from "../db/queries.js";

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Outcome of processing one event. `retry` means a recoverable dependency is not
 * ready yet (e.g. the customer.subscription.* event arrived before the checkout
 * that maps the customer) — the event is NOT marked processed and the route
 * returns a retryable 503 so Stripe redelivers. `done` carries the audit row to
 * be committed atomically with the 'processed' flip (never before success).
 */
type ProcessResult = { outcome: "done"; audit?: SubscriptionEventInput } | { outcome: "retry" };

/** Give up (→ 'terminal_failed', 200) after this many recoverable failures. */
const MAX_ATTEMPTS = 10;

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
 *  the user identified by the checkout's client_reference_id. Idempotent
 *  (ON CONFLICT upsert) and order-independent: it never depends on the
 *  subscription events, and the subscription events retry until it has run. */
async function handleCheckoutCompleted(db: D1Database, obj: Record<string, unknown>): Promise<ProcessResult> {
  const userId = str(obj, "client_reference_id");
  const customerId = str(obj, "customer");
  if (!userId || !customerId) return { outcome: "done" }; // nothing to map → acknowledge
  await upsertBillingCustomer(db, {
    userId,
    provider: "stripe",
    providerCustomerId: customerId,
    email: extractEmail(obj),
  });
  return { outcome: "done" };
}

/** Sync a subscription + create/update its paid entitlement (idempotent). Returns
 *  `retry` (recoverable) when the customer isn't mapped yet or the price/plan
 *  can't be resolved — so the event is redelivered rather than silently dropped. */
async function handleSubscriptionUpsert(db: D1Database, env: Env, obj: Record<string, unknown>, nowMs: number): Promise<ProcessResult> {
  const providerSubId = str(obj, "id");
  const customerId = str(obj, "customer");
  const status = str(obj, "status");
  if (!providerSubId || !customerId || !status) return { outcome: "done" }; // malformed → nothing to process

  const customer = await getBillingCustomerByProviderId(db, "stripe", customerId);
  if (!customer) return { outcome: "retry" }; // customer not mapped yet (checkout not processed) → recoverable

  const priceId = firstPriceId(obj);
  const plan = priceId ? resolvePlanFromPriceId(env, priceId) : null;
  if (!plan) return { outcome: "retry" }; // price/plan not resolvable yet → recoverable (config may lag)

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

  return {
    outcome: "done",
    audit: {
      entitlementId,
      billingSubscriptionId: subId,
      type: `subscription.${billingStatus}`,
      fromStatus,
      toStatus: entStatus,
      actor: "webhook",
      payload: { providerSubId, plan: plan.planId, interval: plan.interval },
    },
  };
}

/** Subscription ended: expire the mirror + the paid entitlement (never revoked).
 *  Returns `retry` when the subscription mirror doesn't exist yet (a delete that
 *  raced ahead of its create) — so the cancellation is never lost. */
async function handleSubscriptionDeleted(db: D1Database, obj: Record<string, unknown>, nowMs: number): Promise<ProcessResult> {
  const providerSubId = str(obj, "id");
  if (!providerSubId) return { outcome: "done" };
  const subRow = await getSubscriptionByProviderId(db, "stripe", providerSubId);
  if (!subRow) return { outcome: "retry" }; // mirror not created yet → recoverable (don't drop the cancellation)

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
    return {
      outcome: "done",
      audit: {
        entitlementId: subRow.entitlement_id,
        billingSubscriptionId: subRow.id,
        type: "subscription.expired",
        fromStatus: ent?.status ?? null,
        toStatus: "expired",
        actor: "webhook",
        payload: { providerSubId },
      },
    };
  }
  return { outcome: "done" };
}

async function processEvent(db: D1Database, env: Env, event: StripeEvent, nowMs: number): Promise<ProcessResult> {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(db, obj);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return handleSubscriptionUpsert(db, env, obj, nowMs);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(db, obj, nowMs);
    default:
      return { outcome: "done" }; // unknown type → acknowledged no-op (marked processed, not retried)
  }
}

/**
 * Full webhook pipeline. Signature → billing flag → atomic claim → business
 * mutation → 'processed'. An event is only ever marked processed once its
 * mutation actually succeeded; a recoverable dependency (e.g. the customer isn't
 * mapped yet because checkout.session.completed hasn't been processed) returns a
 * retryable 503 so Stripe redelivers — never a 200 that would drop the event.
 * The claim serializes concurrent deliveries of the same event (only one
 * processes); every business mutation is an idempotent upsert, and the audit row
 * is committed atomically with the 'processed' flip → no double entitlement,
 * subscription, or audit.
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

  // Atomic claim: exactly one attempt processes an event at a time.
  const claim = await claimWebhookEvent(db, event.id, event.type, nowMs);
  if (claim.decision === "duplicate") return { status: 200, body: { received: true, duplicate: true } };
  if (claim.decision === "terminal") return { status: 200, body: { received: true, terminal: true } };
  if (claim.decision === "in_progress") return { status: 503, body: { error: "webhook_processing_in_progress" } };

  // Claimed → run the (idempotent) mutation. Any throw leaves the event
  // retryable so it is redelivered rather than stuck as processed.
  let result: ProcessResult;
  try {
    result = await processEvent(db, env, event, nowMs);
  } catch {
    await markWebhookEventRetryable(db, event.id, nowMs);
    return { status: 503, body: { error: "webhook_processing_error" } };
  }

  if (result.outcome === "retry") {
    // Bound the retries: give up after MAX_ATTEMPTS so a permanently-stuck event
    // (e.g. a price never in our config) stops instead of retrying forever.
    if (claim.attempts >= MAX_ATTEMPTS) {
      await markWebhookEventTerminal(db, event.id, nowMs);
      return { status: 200, body: { received: true, terminal: true } };
    }
    await markWebhookEventRetryable(db, event.id, nowMs);
    return { status: 503, body: { error: "webhook_dependency_not_ready" } };
  }

  // Success: journal the transition (if any) and flip to 'processed' atomically.
  const statements: D1PreparedStatement[] = [];
  if (result.audit) statements.push(subscriptionEventStatement(db, result.audit));
  statements.push(webhookProcessedStatement(db, event.id, nowMs));
  await db.batch(statements);
  return { status: 200, body: { received: true } };
}
