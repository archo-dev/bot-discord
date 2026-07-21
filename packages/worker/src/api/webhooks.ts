import { Hono } from "hono";
import type { Env } from "../env.js";
import { handleStripeWebhook } from "../billing/webhook-handler.js";

/**
 * Payment provider webhooks (M10). Mounted on the root app, OUTSIDE the
 * session-guarded /api and WITHOUT browserMutationOrigin: these are
 * server-to-server calls whose only trust anchor is the verified signature.
 * The signed, idempotent handler is the sole path that creates/updates a paid
 * entitlement — never a frontend redirect or `success=true`.
 */
export const webhooksRouter = new Hono<{ Bindings: Env }>();

webhooksRouter.post("/webhooks/stripe", async (c) => {
  const rawBody = await c.req.text(); // signature is verified over the RAW body
  const result = await handleStripeWebhook(
    c.env.DB,
    c.env,
    rawBody,
    c.req.header("stripe-signature"),
    Date.now(),
  );
  return c.json(result.body, result.status as 200 | 400 | 503);
});
