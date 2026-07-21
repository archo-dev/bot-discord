/** Billing adapter resolution (M9). Returns the configured sandbox adapter or
 * null when unconfigured (no provider / no secret) → the API reports the feature
 * as unavailable rather than failing. TEST keys only, provided out of repo. */

import type { Env } from "../env.js";
import type { BillingAdapter } from "./provider.js";
import { createStripeAdapter } from "./stripe.js";

export function getBillingAdapter(env: Env): BillingAdapter | null {
  if (env.BILLING_PROVIDER === "stripe" && env.STRIPE_SECRET_KEY) {
    return createStripeAdapter(env.STRIPE_SECRET_KEY);
  }
  return null;
}

/** Configured provider price id for a plan+interval, or null if unset. */
export function resolvePriceId(env: Env, planId: "premium" | "business", interval: "month" | "year"): string | null {
  const key = `BILLING_PRICE_${planId.toUpperCase()}_${interval.toUpperCase()}` as keyof Env;
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reverse map a provider price id → plan+interval (webhook, M10), or null. */
export function resolvePlanFromPriceId(
  env: Env,
  priceId: string,
): { planId: "premium" | "business"; interval: "month" | "year" } | null {
  const table: Array<[keyof Env, "premium" | "business", "month" | "year"]> = [
    ["BILLING_PRICE_PREMIUM_MONTH", "premium", "month"],
    ["BILLING_PRICE_PREMIUM_YEAR", "premium", "year"],
    ["BILLING_PRICE_BUSINESS_MONTH", "business", "month"],
    ["BILLING_PRICE_BUSINESS_YEAR", "business", "year"],
  ];
  for (const [key, planId, interval] of table) {
    if (env[key] && env[key] === priceId) return { planId, interval };
  }
  return null;
}

export type { BillingAdapter } from "./provider.js";
