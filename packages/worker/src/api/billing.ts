import { Hono } from "hono";
import { z } from "zod";
import type {
  BillingInterval,
  BillingProvider,
  BillingResponse,
  BillingSubscriptionStatus,
  CheckoutSessionResponse,
  PlanId,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import type { Env } from "../env.js";
import { getWorkerFlags } from "../config/flags.js";
import { getBillingAdapter, resolvePriceId, type BillingAdapter } from "../billing/index.js";
import { getBillingCustomerByUser, getSubscriptionByUser } from "../db/queries.js";

/**
 * Billing sandbox API (M9). User-level, session-scoped, behind platform.billing.
 * Read state + create hosted checkout/portal sessions via a decoupled adapter.
 * NEVER creates a paid entitlement (that is the signed webhook's job — M10) and
 * never exposes secrets or another user's data.
 */
export const billingRouter = new Hono<AppContext>();

type PaidPlan = "premium" | "business";

export async function buildBillingResponse(
  db: D1Database,
  userId: string,
  enabled: boolean,
  provider: BillingProvider | null,
): Promise<BillingResponse> {
  if (!enabled) {
    return { enabled: false, provider: null, hasCustomer: false, subscription: null, portalAvailable: false };
  }
  const customer = await getBillingCustomerByUser(db, userId);
  const sub = await getSubscriptionByUser(db, userId);
  return {
    enabled: true,
    provider,
    hasCustomer: customer !== null,
    subscription: sub
      ? {
          planId: sub.plan_id as PlanId,
          status: sub.status as BillingSubscriptionStatus,
          interval: sub.interval as BillingInterval,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end === 1,
        }
      : null,
    portalAvailable: customer !== null,
  };
}

type ServiceResult = { url: string } | { error: string; status: 404 | 503 };

/** Create a hosted checkout session for the user. Adapter injected → testable.
 *  Creates NO entitlement (paid is confirmed only by the M10 webhook). */
export async function createCheckoutForUser(
  db: D1Database,
  adapter: BillingAdapter,
  env: Env,
  userId: string,
  planId: PaidPlan,
  interval: BillingInterval,
): Promise<ServiceResult> {
  const priceId = resolvePriceId(env, planId, interval);
  if (!priceId) return { error: "billing_unavailable", status: 503 };
  const customer = await getBillingCustomerByUser(db, userId);
  const origin = env.PANEL_ORIGIN;
  const { url } = await adapter.createCheckoutSession({
    planId,
    interval,
    priceId,
    successUrl: env.BILLING_SUCCESS_URL ?? `${origin}/app/billing?checkout=success`,
    cancelUrl: env.BILLING_CANCEL_URL ?? `${origin}/app/billing?checkout=cancel`,
    clientReferenceId: userId,
    customerId: customer?.provider_customer_id,
  });
  return { url };
}

export async function createPortalForUser(
  db: D1Database,
  adapter: BillingAdapter,
  env: Env,
  userId: string,
): Promise<ServiceResult> {
  const customer = await getBillingCustomerByUser(db, userId);
  if (!customer) return { error: "no_customer", status: 404 };
  const { url } = await adapter.createPortalSession({
    customerId: customer.provider_customer_id,
    returnUrl: env.BILLING_SUCCESS_URL ?? `${env.PANEL_ORIGIN}/app/billing`,
  });
  return { url };
}

billingRouter.get("/billing", async (c) => {
  const enabled = getWorkerFlags(c.env)["platform.billing"];
  const provider = getBillingAdapter(c.env)?.provider ?? null;
  return c.json(await buildBillingResponse(c.env.DB, c.get("session").userId, enabled, provider));
});

const checkoutSchema = z.object({
  planId: z.enum(["premium", "business"]),
  interval: z.enum(["month", "year"]),
});

billingRouter.post("/billing/checkout", async (c) => {
  if (!getWorkerFlags(c.env)["platform.billing"]) return c.json({ error: "feature_disabled" }, 404);
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const adapter = getBillingAdapter(c.env);
  if (!adapter) return c.json({ error: "billing_unavailable" }, 503);
  const result = await createCheckoutForUser(
    c.env.DB, adapter, c.env, c.get("session").userId, parsed.data.planId, parsed.data.interval,
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result satisfies CheckoutSessionResponse);
});

billingRouter.post("/billing/portal", async (c) => {
  if (!getWorkerFlags(c.env)["platform.billing"]) return c.json({ error: "feature_disabled" }, 404);
  const adapter = getBillingAdapter(c.env);
  if (!adapter) return c.json({ error: "billing_unavailable" }, 503);
  const result = await createPortalForUser(c.env.DB, adapter, c.env, c.get("session").userId);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result satisfies CheckoutSessionResponse);
});
