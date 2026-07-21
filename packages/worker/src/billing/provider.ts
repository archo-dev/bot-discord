/** Decoupled billing adapter interface (M9). Isolates the provider behind a
 * stable contract so switching providers = swapping the adapter, without
 * touching entitlements. Only hosted flows (checkout/portal) — no card data. */

import type { BillingInterval, BillingProvider, PlanId } from "@bot/shared";

export interface CheckoutParams {
  planId: Exclude<PlanId, "free">;
  interval: BillingInterval;
  /** Provider price id resolved from config (never hard-coded). */
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  /** Reference attached so the webhook (M10) can map the session back to the user. */
  clientReferenceId: string;
  /** Existing provider customer id, if the user already has one. */
  customerId?: string;
}

export interface PortalParams {
  customerId: string;
  returnUrl: string;
}

export interface BillingAdapter {
  readonly provider: BillingProvider;
  createCheckoutSession(params: CheckoutParams): Promise<{ url: string }>;
  createPortalSession(params: PortalParams): Promise<{ url: string }>;
}
