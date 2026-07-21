import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import type { BillingResponse } from "@bot/shared";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import { createSession } from "../src/auth/session.js";
import {
  buildBillingResponse,
  createCheckoutForUser,
  createPortalForUser,
} from "../src/api/billing.js";
import type { BillingAdapter } from "../src/billing/index.js";
import { buildCheckoutSessionRequest, buildPortalRequest, parseSessionResponse } from "../src/billing/stripe.js";
import { insertBillingCustomer, insertBillingSubscription } from "../src/db/queries.js";

// D1/KV roll back between tests. No fetchMock: billing reads D1 and the adapter
// is injected (fake) — no network, no Stripe keys.

const USER = "830000000000000001";
const OTHER = "830000000000000002";

const fakeAdapter: BillingAdapter = {
  provider: "stripe",
  createCheckoutSession: async () => ({ url: "https://checkout.stripe.test/session_x" }),
  createPortalSession: async () => ({ url: "https://portal.stripe.test/x" }),
};

async function seedSubscription(userId: string): Promise<void> {
  const customerId = await insertBillingCustomer(env.DB, {
    userId, provider: "stripe", providerCustomerId: `cus_${userId}`, email: "hidden@example.com",
  });
  await insertBillingSubscription(env.DB, {
    customerId, provider: "stripe", providerSubscriptionId: `sub_${userId}`,
    planId: "premium", status: "active", interval: "month", currentPeriodEnd: "2027-01-01T00:00:00.000Z",
  });
}

describe("M9 billing — read service", () => {
  it("flag off → inert (enabled false, all null)", async () => {
    await seedSubscription(USER);
    const r = await buildBillingResponse(env.DB, USER, false, null);
    expect(r).toEqual({ enabled: false, provider: null, hasCustomer: false, subscription: null, portalAvailable: false });
  });

  it("reflects the user's subscription without leaking email/secrets", async () => {
    await seedSubscription(USER);
    const r = await buildBillingResponse(env.DB, USER, true, "stripe");
    expect(r.enabled).toBe(true);
    expect(r.hasCustomer).toBe(true);
    expect(r.subscription?.planId).toBe("premium");
    expect(r.subscription?.status).toBe("active");
    expect(JSON.stringify(r)).not.toContain("hidden@example.com");
    expect(JSON.stringify(r)).not.toContain("cus_");
  });

  it("is scoped to the user (no cross-user leak)", async () => {
    await seedSubscription(OTHER);
    const r = await buildBillingResponse(env.DB, USER, true, "stripe");
    expect(r.hasCustomer).toBe(false);
    expect(r.subscription).toBeNull();
  });
});

describe("M9 billing — checkout/portal service (injected adapter)", () => {
  const priceEnv = {
    PANEL_ORIGIN: "https://panel.test",
    BILLING_PRICE_PREMIUM_MONTH: "price_premium_month",
  } as unknown as Env;

  it("checkout returns a hosted URL and creates NO entitlement", async () => {
    const res = await createCheckoutForUser(env.DB, fakeAdapter, priceEnv, USER, "premium", "month");
    expect(res).toEqual({ url: "https://checkout.stripe.test/session_x" });
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?1`).bind(USER).first<{ n: number }>();
    expect(count!.n).toBe(0); // paid is created only by the M10 webhook
  });

  it("checkout is unavailable when the price is not configured", async () => {
    const res = await createCheckoutForUser(env.DB, fakeAdapter, {} as Env, USER, "business", "year");
    expect(res).toEqual({ error: "billing_unavailable", status: 503 });
  });

  it("portal requires an existing customer", async () => {
    expect(await createPortalForUser(env.DB, fakeAdapter, priceEnv, USER)).toEqual({ error: "no_customer", status: 404 });
    await seedSubscription(USER);
    expect(await createPortalForUser(env.DB, fakeAdapter, priceEnv, USER)).toEqual({ url: "https://portal.stripe.test/x" });
  });
});

describe("M9 billing — HTTP surface", () => {
  async function session(userId: string): Promise<string> {
    return createSession(env, {
      userId, username: "billing-user", globalName: null, avatar: null,
      accessToken: "tok", refreshToken: "unused", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
    });
  }

  it("GET /api/billing requires a session", async () => {
    expect((await app.request("/api/billing", { method: "GET" }, env, createExecutionContext())).status).toBe(401);
  });

  it("GET /api/billing is inert with the flag off (default)", async () => {
    const sid = await session(USER);
    const res = await app.request("/api/billing", { method: "GET", headers: { cookie: `session=${sid}` } }, env, createExecutionContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as BillingResponse;
    expect(body.enabled).toBe(false);
    expect(body.subscription).toBeNull();
  });

  it("POST /api/billing/checkout is disabled with the flag off", async () => {
    const sid = await session(USER);
    const res = await app.request(
      "/api/billing/checkout",
      { method: "POST", headers: { cookie: `session=${sid}`, "content-type": "application/json" }, body: JSON.stringify({ planId: "premium", interval: "month" }) },
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("feature_disabled");
  });
});

describe("M9 Stripe adapter (pure request building)", () => {
  it("builds a hosted subscription checkout request", () => {
    const req = buildCheckoutSessionRequest(
      { planId: "premium", interval: "month", priceId: "price_x", successUrl: "https://s/ok", cancelUrl: "https://s/no", clientReferenceId: "u1" },
      "sk_test_123",
    );
    expect(req.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(req.headers.authorization).toBe("Bearer sk_test_123");
    expect(req.body).toContain("mode=subscription");
    expect(req.body).toContain("line_items%5B0%5D%5Bprice%5D=price_x");
    expect(req.body).toContain("client_reference_id=u1");
  });

  it("builds a customer portal request", () => {
    const req = buildPortalRequest({ customerId: "cus_1", returnUrl: "https://s/back" }, "sk_test_123");
    expect(req.url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(req.body).toContain("customer=cus_1");
  });

  it("parses the session url, throws on malformed response", () => {
    expect(parseSessionResponse({ url: "https://x" })).toEqual({ url: "https://x" });
    expect(() => parseSessionResponse({})).toThrow();
    expect(() => parseSessionResponse(null)).toThrow();
  });
});
