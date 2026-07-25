import { Hono } from "hono";
import {
  EFFECTIVE_FREE,
  PLAN_CAPABILITIES,
  PLAN_CAPABILITY_POLICY,
  resolveEffectiveEntitlement,
  type CapabilityPolicyResponse,
  type SubscriptionResponse,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import { getEnforcementMode, getWorkerFlags } from "../config/flags.js";
import { listUserEntitlements, rowToEntitlementInput } from "../db/queries.js";

export const subscriptionRouter = new Hono<AppContext>();

// D29 (feature-to-plan mapping) is not decided yet. Expose the effective
// backend policy explicitly so the panel never implies that the displayed
// commercial plan is already used to gate client features.
const FEATURE_ACCESS_MODE = "early_access" as const;

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
    originKind: effective.originKind,
    status: effective.status,
    // The resolved best is by definition effective ⇒ 'active'; free default ⇒ null.
    effectiveState: effective.source === null ? null : "active",
    isLifetime: effective.isLifetime,
    startAt: effective.startAt,
    endAt: effective.endAt,
    entitlementsEnabled,
    featureAccessMode: FEATURE_ACCESS_MODE,
  };
}

subscriptionRouter.get("/subscription", async (c) => {
  const enabled = getWorkerFlags(c.env)["platform.entitlements"];
  const body = await buildSubscriptionResponse(c.env.DB, c.get("session").userId, enabled);
  return c.json(body);
});

// Read-only plan capability catalog + policy + mode courant (affichage panel).
// Centralisé ; jamais de donnée de paiement. Le mode reflète l'env (off en prod).
subscriptionRouter.get("/capabilities", (c) => {
  const body: CapabilityPolicyResponse = {
    enforcementMode: getEnforcementMode(c.env),
    plans: PLAN_CAPABILITIES,
    policy: PLAN_CAPABILITY_POLICY,
  };
  return c.json(body);
});
