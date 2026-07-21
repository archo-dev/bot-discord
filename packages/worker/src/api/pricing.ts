import { Hono } from "hono";
import { resolveLaunchPricing, type PricingResponse } from "@bot/shared";
import type { Env } from "../env.js";
import { getWorkerFlags } from "../config/flags.js";

/**
 * Public launch pricing (M16). Prices are NEVER hardcoded (owner decision D1):
 * they come from LAUNCH_* config and are only surfaced when platform.launch is
 * on AND the config is complete. Off / incomplete → pricing:null → the panel
 * shows "Tarifs à venir". No PII, no session, no-store.
 */
export const pricingRouter = new Hono<{ Bindings: Env }>();

pricingRouter.get("/api/pricing", (c) => {
  const launch = getWorkerFlags(c.env)["platform.launch"];
  const pricing = launch
    ? resolveLaunchPricing({
        currency: c.env.LAUNCH_CURRENCY,
        premiumMonthly: c.env.LAUNCH_PRICE_PREMIUM_MONTH,
        premiumYearly: c.env.LAUNCH_PRICE_PREMIUM_YEAR,
        businessMonthly: c.env.LAUNCH_PRICE_BUSINESS_MONTH,
        businessYearly: c.env.LAUNCH_PRICE_BUSINESS_YEAR,
      })
    : null;
  const body: PricingResponse = { launch: launch && pricing !== null, pricing };
  c.header("cache-control", "no-store");
  return c.json(body);
});
