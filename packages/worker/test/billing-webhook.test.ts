import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import { handleStripeWebhook } from "../src/billing/webhook-handler.js";
import { signStripePayload, verifyStripeSignature } from "../src/billing/stripe-webhook.js";
import { buildSubscriptionResponse } from "../src/api/subscription.js";
import {
  getBillingCustomerByProviderId,
  listUserEntitlements,
  updatePaidEntitlement,
} from "../src/db/queries.js";

// D1/KV roll back between tests. No fetchMock: the webhook only touches D1 and
// verifies signatures with Web Crypto (no network, no Stripe keys).

const USER = "840000000000000001";
const OTHER = "840000000000000002";
const SECRET = "whsec_test_secret";
const FUTURE = Math.floor(Date.parse("2999-01-01T00:00:00Z") / 1000);

const WEBHOOK_ENV = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  PLATFORM_BILLING: "true",
  BILLING_PROVIDER: "stripe",
  BILLING_PRICE_PREMIUM_MONTH: "price_pm",
  BILLING_PRICE_BUSINESS_MONTH: "price_bm",
  PANEL_ORIGIN: "https://panel.test",
} as unknown as Env;

function checkoutEvent(id: string, userId: string, customer: string) {
  return { id, type: "checkout.session.completed", data: { object: { client_reference_id: userId, customer, customer_details: { email: "u@example.com" } } } };
}
function subEvent(id: string, type: string, sub: string, customer: string, status: string, price: string, periodEnd = FUTURE) {
  return {
    id, type,
    data: { object: { id: sub, customer, status, current_period_end: periodEnd, cancel_at_period_end: false, items: { data: [{ price: { id: price } }] } } },
  };
}

async function deliver(event: unknown, opts: { now?: number; secret?: string; env?: Env; sig?: string } = {}) {
  const body = JSON.stringify(event);
  const now = opts.now ?? Date.now();
  const sig = opts.sig ?? (await signStripePayload(opts.secret ?? SECRET, Math.floor(now / 1000), body));
  return handleStripeWebhook(env.DB, opts.env ?? WEBHOOK_ENV, body, sig, now);
}

async function paidEntitlements(userId: string) {
  return (await listUserEntitlements(env.DB, userId)).filter((e) => e.source === "paid");
}

describe("M10 Stripe signature verification", () => {
  it("accepts a valid signature and rejects tampering/replay/malformed", async () => {
    const body = JSON.stringify({ hello: "world" });
    const now = Date.now();
    const t = Math.floor(now / 1000);
    const sig = await signStripePayload(SECRET, t, body);
    expect(await verifyStripeSignature(body, sig, SECRET, now)).toBe(true);
    expect(await verifyStripeSignature(body, sig, "whsec_wrong", now)).toBe(false);
    expect(await verifyStripeSignature(`${body} `, sig, SECRET, now)).toBe(false); // tampered body
    expect(await verifyStripeSignature(body, sig, SECRET, now + 10 * 60 * 1000)).toBe(false); // expired
    expect(await verifyStripeSignature(body, "garbage", SECRET, now)).toBe(false);
    expect(await verifyStripeSignature(body, undefined, SECRET, now)).toBe(false);
  });
});

describe("M10 webhook — gating & guards", () => {
  it("503 when not configured (no secret)", async () => {
    const res = await deliver(checkoutEvent("evt_x", USER, "cus_1"), { env: {} as Env });
    expect(res.status).toBe(503);
  });

  it("400 on invalid signature, no mutation", async () => {
    const res = await handleStripeWebhook(env.DB, WEBHOOK_ENV, JSON.stringify(checkoutEvent("evt_1", USER, "cus_1")), "t=1,v1=deadbeef", Date.now());
    expect(res.status).toBe(400);
    expect(await getBillingCustomerByProviderId(env.DB, "stripe", "cus_1")).toBeNull();
  });

  it("200 ignored with the billing flag off (kill-switch), no mutation", async () => {
    const flagOff = { ...WEBHOOK_ENV, PLATFORM_BILLING: undefined } as Env;
    const res = await deliver(checkoutEvent("evt_1", USER, "cus_1"), { env: flagOff });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(await getBillingCustomerByProviderId(env.DB, "stripe", "cus_1")).toBeNull();
  });

  it("a paid entitlement can never be revoked (guard)", async () => {
    await deliver(checkoutEvent("evt_1", USER, "cus_1"));
    await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    const [ent] = await paidEntitlements(USER);
    await expect(updatePaidEntitlement(env.DB, ent!.id, "premium", "revoked", "2999-01-01T00:00:00.000Z")).rejects.toThrow();
  });
});

describe("M10 webhook — paid lifecycle (verified events only)", () => {
  it("creates a paid entitlement from a verified subscription (not from checkout alone)", async () => {
    await deliver(checkoutEvent("evt_1", USER, "cus_1"));
    // checkout maps the customer but creates NO entitlement yet
    expect(await paidEntitlements(USER)).toHaveLength(0);

    await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    const paid = await paidEntitlements(USER);
    expect(paid).toHaveLength(1);
    expect(paid[0]!.plan_id).toBe("premium");
    expect(paid[0]!.status).toBe("active");
    expect((await buildSubscriptionResponse(env.DB, USER, true)).planId).toBe("premium");
  });

  it("is idempotent: replaying the same event does not duplicate the entitlement", async () => {
    await deliver(checkoutEvent("evt_1", USER, "cus_1"));
    const first = await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    const replay = await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    expect(first.body.received).toBe(true);
    expect(replay.body.duplicate).toBe(true);
    expect(await paidEntitlements(USER)).toHaveLength(1);
  });

  it("drives status transitions: active → past_due → active", async () => {
    await deliver(checkoutEvent("evt_1", USER, "cus_1"));
    await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    await deliver(subEvent("evt_3", "customer.subscription.updated", "sub_1", "cus_1", "past_due", "price_pm"));
    expect((await paidEntitlements(USER))[0]!.status).toBe("past_due");
    await deliver(subEvent("evt_4", "customer.subscription.updated", "sub_1", "cus_1", "active", "price_pm"));
    expect((await paidEntitlements(USER))[0]!.status).toBe("active");
  });

  it("applies plan changes and expiry; effective plan returns to free", async () => {
    await deliver(checkoutEvent("evt_1", USER, "cus_1"));
    await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    await deliver(subEvent("evt_3", "customer.subscription.updated", "sub_1", "cus_1", "active", "price_bm"));
    expect((await paidEntitlements(USER))[0]!.plan_id).toBe("business");
    expect((await buildSubscriptionResponse(env.DB, USER, true)).planId).toBe("business");

    await deliver(subEvent("evt_4", "customer.subscription.deleted", "sub_1", "cus_1", "canceled", "price_bm"));
    expect((await paidEntitlements(USER))[0]!.status).toBe("expired");
    expect((await buildSubscriptionResponse(env.DB, USER, true)).planId).toBe("free");
  });

  it("attaches the entitlement only to the mapped user (isolation)", async () => {
    await deliver(checkoutEvent("evt_1", USER, "cus_1"));
    await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    expect(await paidEntitlements(USER)).toHaveLength(1);
    expect(await paidEntitlements(OTHER)).toHaveLength(0);
  });

  it("returns a RETRYABLE 503 (never 200) when the customer isn't mapped yet — the event is not lost", async () => {
    const res = await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_unknown", "active", "price_pm"));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("webhook_dependency_not_ready");
    expect(await paidEntitlements(USER)).toHaveLength(0);
    // NOT marked processed → a later delivery (after checkout maps the customer) reclaims it.
    const row = await env.DB.prepare(`SELECT status FROM billing_webhook_events WHERE event_id='evt_2'`).first<{ status: string }>();
    expect(row?.status).toBe("retryable_failed");
  });

  it("journals each transition in subscription_events (audit)", async () => {
    await deliver(checkoutEvent("evt_1", USER, "cus_1"));
    await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    await deliver(subEvent("evt_3", "customer.subscription.updated", "sub_1", "cus_1", "past_due", "price_pm"));
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM subscription_events WHERE actor = 'webhook'`).first<{ n: number }>();
    expect(row!.n).toBeGreaterThanOrEqual(2);
  });
});

describe("webhook ordering fix — out-of-order Stripe deliveries are not lost", () => {
  async function count(sql: string): Promise<number> {
    return (await env.DB.prepare(sql).first<{ n: number }>())!.n;
  }

  it("subscription.created BEFORE checkout → 503 retryable, then reclaimed after checkout; paid/subscription/audit created exactly once; replay → duplicate", async () => {
    // 1) subscription.created arrives first → customer not mapped → retryable 503, nothing created.
    const first = await deliver(subEvent("evt_sub", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    expect(first.status).toBe(503);
    expect(first.body.error).toBe("webhook_dependency_not_ready");
    expect(await paidEntitlements(USER)).toHaveLength(0);

    // 2) checkout maps the customer (idempotent, order-independent).
    expect((await deliver(checkoutEvent("evt_co", USER, "cus_1"))).status).toBe(200);
    expect(await getBillingCustomerByProviderId(env.DB, "stripe", "cus_1")).not.toBeNull();

    // 3) Stripe redelivers the SAME subscription event id → now the dependency is satisfied.
    const retry = await deliver(subEvent("evt_sub", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    expect(retry.status).toBe(200);
    expect(retry.body.received).toBe(true);

    expect(await paidEntitlements(USER)).toHaveLength(1);
    expect((await paidEntitlements(USER))[0]!.plan_id).toBe("premium");
    expect(await count(`SELECT COUNT(*) AS n FROM billing_subscriptions WHERE provider_subscription_id='sub_1'`)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM subscription_events WHERE actor='webhook'`)).toBe(1);

    const st = await env.DB.prepare(`SELECT status, attempts FROM billing_webhook_events WHERE event_id='evt_sub'`).first<{ status: string; attempts: number }>();
    expect(st?.status).toBe("processed");
    expect(st!.attempts).toBeGreaterThanOrEqual(2);

    // 4) A further replay of the now-processed event → 200 duplicate, no re-processing.
    const replay = await deliver(subEvent("evt_sub", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    expect(replay.body.duplicate).toBe(true);
    expect(await paidEntitlements(USER)).toHaveLength(1);
    expect(await count(`SELECT COUNT(*) AS n FROM subscription_events WHERE actor='webhook'`)).toBe(1);
  });

  it("two concurrent deliveries of the same claimable event → exactly one processes (no double entitlement/subscription/audit)", async () => {
    expect((await deliver(checkoutEvent("evt_co2", USER, "cus_1"))).status).toBe(200);
    const ev = subEvent("evt_conc", "customer.subscription.created", "sub_c", "cus_1", "active", "price_pm");
    const [a, b] = await Promise.all([deliver(ev), deliver(ev)]);

    // Never two 200-received: at most one processes; the other is duplicate (200) or in_progress (503).
    expect([a.status, b.status].filter((s) => s === 200 && "received").length).toBeGreaterThanOrEqual(1);
    expect(await paidEntitlements(USER)).toHaveLength(1);
    expect(await count(`SELECT COUNT(*) AS n FROM billing_subscriptions WHERE provider_subscription_id='sub_c'`)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM subscription_events WHERE actor='webhook'`)).toBe(1);
  });

  it("subscription.deleted BEFORE its create → retryable 503 (cancellation is never dropped)", async () => {
    const res = await deliver(subEvent("evt_del", "customer.subscription.deleted", "sub_x", "cus_1", "canceled", "price_pm"));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("webhook_dependency_not_ready");
    const row = await env.DB.prepare(`SELECT status FROM billing_webhook_events WHERE event_id='evt_del'`).first<{ status: string }>();
    expect(row?.status).toBe("retryable_failed");
  });

  it("unknown event type → acknowledged 200 and marked processed (documented no-op, not retried)", async () => {
    const res = await deliver({ id: "evt_unknown", type: "invoice.paid", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    const row = await env.DB.prepare(`SELECT status FROM billing_webhook_events WHERE event_id='evt_unknown'`).first<{ status: string }>();
    expect(row?.status).toBe("processed");
  });
});

describe("M10 webhook — HTTP route", () => {
  it("POST /webhooks/stripe rejects when unconfigured/unsigned (>= 400)", async () => {
    const res = await app.request(
      "/webhooks/stripe",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(checkoutEvent("evt_1", USER, "cus_1")) },
      env,
      createExecutionContext(),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
