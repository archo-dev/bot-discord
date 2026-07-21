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

export type { BillingAdapter } from "./provider.js";
