/** Launch pricing DTOs (M16). Prices are NEVER hardcoded in the code base
 * (decision D1 is the owner's): amounts arrive from configuration and are
 * resolved here. Amounts are integers in the currency's smallest unit (e.g.
 * cents) to avoid floating point. resolveLaunchPricing returns null when the
 * config is incomplete — it never invents a value. */

/** Monthly + yearly amount for one plan, in the smallest currency unit. */
export interface PlanPricing {
  monthly: number;
  yearly: number;
}

export interface LaunchPricing {
  /** ISO 4217, e.g. "EUR". */
  currency: string;
  premium: PlanPricing;
  business: PlanPricing;
}

export interface PricingResponse {
  /** True when platform.launch is on AND pricing is fully configured. */
  launch: boolean;
  /** Null until real prices are configured (owner decision D1) — never invented. */
  pricing: LaunchPricing | null;
}

/** Raw config shape (values are strings from env; parsed here). */
export interface LaunchPricingConfig {
  currency?: string | null;
  premiumMonthly?: string | null;
  premiumYearly?: string | null;
  businessMonthly?: string | null;
  businessYearly?: string | null;
}

function parseAmount(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Resolve configured launch pricing, or null if any amount/currency is missing
 * or invalid. Pure/deterministic — no defaults invented, no floats.
 */
export function resolveLaunchPricing(cfg: LaunchPricingConfig): LaunchPricing | null {
  const currency = cfg.currency?.trim();
  const pm = parseAmount(cfg.premiumMonthly);
  const py = parseAmount(cfg.premiumYearly);
  const bm = parseAmount(cfg.businessMonthly);
  const by = parseAmount(cfg.businessYearly);
  if (!currency || !/^[A-Z]{3}$/.test(currency) || pm === null || py === null || bm === null || by === null) {
    return null;
  }
  return {
    currency,
    premium: { monthly: pm, yearly: py },
    business: { monthly: bm, yearly: by },
  };
}
