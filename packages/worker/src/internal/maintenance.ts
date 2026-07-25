import { Hono } from "hono";
import type { Env } from "../env.js";
import { sweepExpiredEntitlements } from "../entitlements/sweep.js";

/**
 * Internal maintenance ops (bearer-guarded by the /internal/* middleware). The
 * entitlement expiry sweep normally runs from the per-minute cron, but staging
 * has no cron (wrangler.jsonc → triggers.crons: []); this lets ops/tests trigger
 * one bounded, idempotent pass on demand for staging validation. No PII returned.
 */
export const internalMaintenanceRouter = new Hono<{ Bindings: Env }>();

internalMaintenanceRouter.post("/internal/maintenance/entitlements-sweep", async (c) => {
  const result = await sweepExpiredEntitlements(c.env);
  return c.json(result);
});
