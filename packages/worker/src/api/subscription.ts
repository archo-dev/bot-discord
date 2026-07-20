import { Hono } from "hono";
import {
  EFFECTIVE_FREE,
  resolveEffectiveEntitlement,
  type SubscriptionResponse,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import { getWorkerFlags } from "../config/flags.js";
import { listUserEntitlements, rowToEntitlementInput } from "../db/queries.js";

export const subscriptionRouter = new Hono<AppContext>();

/**
 * Effective plan of a user, resolved server-side (M6). When the entitlements
 * flag is off, resolution is skipped entirely and everyone is Gratuit — the
 * production default, unchanged. Strictly scoped to `userId`: no other user's
 * data is ever read. No billing, no internal origin fields.
 */
export async function buildSubscriptionResponse(
  db: D1Database,
  userId: string,
  entitlementsEnabled: boolean,
): Promise<SubscriptionResponse> {
  const effective = entitlementsEnabled
    ? resolveEffectiveEntitlement(
        (await listUserEntitlements(db, userId)).map(rowToEntitlementInput),
        new Date(),
      )
    : EFFECTIVE_FREE;

  return {
    planId: effective.planId,
    planRank: effective.planRank,
    displayName: effective.displayName,
    slots: effective.slots,
    source: effective.source,
    status: effective.status,
    isLifetime: effective.isLifetime,
    endAt: effective.endAt,
    entitlementsEnabled,
  };
}

subscriptionRouter.get("/subscription", async (c) => {
  const enabled = getWorkerFlags(c.env)["platform.entitlements"];
  const body = await buildSubscriptionResponse(c.env.DB, c.get("session").userId, enabled);
  return c.json(body);
});
