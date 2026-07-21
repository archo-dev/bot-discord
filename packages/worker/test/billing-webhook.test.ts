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

  it("ignores a subscription for an unmapped customer (no entitlement)", async () => {
    const res = await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_unknown", "active", "price_pm"));
    expect(res.status).toBe(200);
    expect(await paidEntitlements(USER)).toHaveLength(0);
  });

  it("journals each transition in subscription_events (audit)", async () => {
    await deliver(checkoutEvent("evt_1", USER, "cus_1"));
    await deliver(subEvent("evt_2", "customer.subscription.created", "sub_1", "cus_1", "active", "price_pm"));
    await deliver(subEvent("evt_3", "customer.subscription.updated", "sub_1", "cus_1", "past_due", "price_pm"));
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM subscription_events WHERE actor = 'webhook'`).first<{ n: number }>();
    expect(row!.n).toBeGreaterThanOrEqual(2);
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
