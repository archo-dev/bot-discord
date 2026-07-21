import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { resolveLaunchPricing } from "@bot/shared";
import app from "../src/index.js";
import type { Env } from "../src/env.js";

// M16 launch pricing. Prices are config-driven — never hardcoded (D1). The flag
// platform.launch gates whether they surface. No session, no PII.

const FULL = {
  LAUNCH_CURRENCY: "EUR",
  LAUNCH_PRICE_PREMIUM_MONTH: "599",
  LAUNCH_PRICE_PREMIUM_YEAR: "5990",
  LAUNCH_PRICE_BUSINESS_MONTH: "1499",
  LAUNCH_PRICE_BUSINESS_YEAR: "14990",
};

function get(e: Env) {
  return app.request("https://archodev.fr/api/pricing", {}, e, createExecutionContext());
}

describe("M16 — resolveLaunchPricing (pure, no invented defaults)", () => {
  it("resolves when complete; null when any amount/currency is missing", () => {
    expect(resolveLaunchPricing({ currency: "EUR", premiumMonthly: "599", premiumYearly: "5990", businessMonthly: "1499", businessYearly: "14990" }))
      .toEqual({ currency: "EUR", premium: { monthly: 599, yearly: 5990 }, business: { monthly: 1499, yearly: 14990 } });
    expect(resolveLaunchPricing({ currency: "EUR", premiumMonthly: "599" })).toBeNull();
    expect(resolveLaunchPricing({ currency: "", premiumMonthly: "1", premiumYearly: "1", businessMonthly: "1", businessYearly: "1" })).toBeNull();
    expect(resolveLaunchPricing({ currency: "EUR", premiumMonthly: "9.99", premiumYearly: "1", businessMonthly: "1", businessYearly: "1" })).toBeNull();
  });
});

describe("M16 — GET /api/pricing", () => {
  it("launch off (default) ⇒ { launch:false, pricing:null }", async () => {
    const res = await get(env as Env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { launch: boolean; pricing: unknown };
    expect(body).toEqual({ launch: false, pricing: null });
  });

  it("launch on + full config ⇒ configured prices", async () => {
    const res = await get({ ...env, PLATFORM_LAUNCH: "true", ...FULL } as Env);
    const body = (await res.json()) as { launch: boolean; pricing: { currency: string; premium: { monthly: number } } | null };
    expect(body.launch).toBe(true);
    expect(body.pricing?.currency).toBe("EUR");
    expect(body.pricing?.premium.monthly).toBe(599);
  });

  it("launch on + incomplete config ⇒ pricing:null (never invented)", async () => {
    const res = await get({ ...env, PLATFORM_LAUNCH: "true", LAUNCH_CURRENCY: "EUR" } as Env);
    const body = (await res.json()) as { launch: boolean; pricing: unknown };
    expect(body.pricing).toBeNull();
    expect(body.launch).toBe(false);
  });
});
