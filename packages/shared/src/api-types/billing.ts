/** Billing DTOs (M9, sandbox). Read-only surface + checkout/portal session
 * results. Decoupled from entitlements via a `provider` field (anti-lock-in).
 * No secrets, no card data (hosted checkout), and the paid entitlement is never
 * created here — its source of truth is the signed webhook (M10). */

import type { EntitlementStatus, PlanId } from "../entitlement.js";

export type BillingProvider = "stripe" | "lemonsqueezy" | "paddle";
export type BillingInterval = "month" | "year";
export type BillingSubscriptionStatus = "active" | "past_due" | "cancelled" | "expired";

/** Provider subscription status → entitlement status (consumed by the M10 webhook). */
export function mapProviderStatusToEntitlementStatus(status: BillingSubscriptionStatus): EntitlementStatus {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
  }
}

/** Public projection of a billing subscription (never exposes provider secrets). */
export interface BillingSubscriptionView {
  planId: PlanId;
  status: BillingSubscriptionStatus;
  interval: BillingInterval;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** GET /api/billing — the signed-in user's billing state (user-scoped). */
export interface BillingResponse {
  /** Whether the platform.billing flag is on. */
  enabled: boolean;
  provider: BillingProvider | null;
  /** True when a billing customer exists (portal reachable). */
  hasCustomer: boolean;
  subscription: BillingSubscriptionView | null;
  portalAvailable: boolean;
}

/** POST /api/billing/checkout|portal — hosted redirect URL. */
export interface CheckoutSessionResponse {
  url: string;
}
