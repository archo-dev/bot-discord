/** Stripe sandbox adapter (M9) via `fetch` — no SDK dependency, Workers-native.
 * Request building and response parsing are PURE (testable without network/keys);
 * only `send` performs I/O. Hosted Checkout + Customer Portal → no card data
 * transits the Worker (PCI minimal). TEST keys only; never creates entitlements. */

import type { BillingAdapter, CheckoutParams, PortalParams } from "./provider.js";

const STRIPE_API = "https://api.stripe.com/v1";

export interface StripeRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

function authHeaders(secretKey: string): Record<string, string> {
  return { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" };
}

/** Build the Stripe Checkout Session request (subscription mode, hosted). Pure. */
export function buildCheckoutSessionRequest(params: CheckoutParams, secretKey: string): StripeRequest {
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("success_url", params.successUrl);
  form.set("cancel_url", params.cancelUrl);
  form.set("line_items[0][price]", params.priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("client_reference_id", params.clientReferenceId);
  if (params.customerId) form.set("customer", params.customerId);
  return { url: `${STRIPE_API}/checkout/sessions`, method: "POST", headers: authHeaders(secretKey), body: form.toString() };
}

/** Build the Stripe Customer Portal session request. Pure. */
export function buildPortalRequest(params: PortalParams, secretKey: string): StripeRequest {
  const form = new URLSearchParams();
  form.set("customer", params.customerId);
  form.set("return_url", params.returnUrl);
  return { url: `${STRIPE_API}/billing_portal/sessions`, method: "POST", headers: authHeaders(secretKey), body: form.toString() };
}

/** Extract the hosted URL from a Stripe session response. Pure. */
export function parseSessionResponse(json: unknown): { url: string } {
  if (json && typeof json === "object" && typeof (json as { url?: unknown }).url === "string") {
    return { url: (json as { url: string }).url };
  }
  throw new Error("stripe_invalid_response");
}

async function send(req: StripeRequest): Promise<{ url: string }> {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (!res.ok) throw new Error(`stripe_error_${res.status}`);
  return parseSessionResponse(await res.json());
}

export function createStripeAdapter(secretKey: string): BillingAdapter {
  return {
    provider: "stripe",
    createCheckoutSession: (p) => send(buildCheckoutSessionRequest(p, secretKey)),
    createPortalSession: (p) => send(buildPortalRequest(p, secretKey)),
  };
}
