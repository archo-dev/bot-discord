/**
 * Automatic expiry sweep for temporary entitlements (chantier « lifecycle »).
 *
 * Bounded + idempotent. For each temporary entitlement whose window has ended
 * (status='active', not lifetime, end_at passed), atomically:
 *   1. flip status → 'expired' (the CLAIM: claimExpiredEntitlements does this and
 *      returns only the rows it actually flipped, so a re-run is a no-op);
 *   2. release any live guild assignment (slot freed, row kept — never destructive);
 *   3. journal a subscription_event;
 *   4. write a system audit row (no raw PII/secret).
 * Lifetime and scheduled (future start) rows are excluded by construction, so the
 * sweep NEVER expires a lifetime. Aggregated metrics only; no token/cookie/secret
 * is ever logged.
 */

import type { Env } from "../env.js";
import {
  claimExpiredEntitlements,
  releaseEntitlementAssignmentsStatement,
  subscriptionEventStatement,
} from "../db/queries.js";
import { writeStudioAudit } from "../security/studio-audit.js";

export interface SweepResult {
  /** Entitlements transitioned active → expired this run. */
  expired: number;
  /** Batches processed (bounded by maxBatches). */
  batches: number;
}

export interface SweepOptions {
  /** Rows claimed per batch (indexed UPDATE…RETURNING). */
  limit?: number;
  /** Safety cap on batches per invocation (bounds cron work). */
  maxBatches?: number;
}

/**
 * Run the expiry sweep. Processes up to `limit * maxBatches` expiries per call;
 * whatever remains is drained by the next cron tick. Safe to run concurrently or
 * repeatedly (each expiry is claimed, journaled and audited exactly once).
 */
export async function sweepExpiredEntitlements(env: Env, options: SweepOptions = {}): Promise<SweepResult> {
  const limit = options.limit ?? 100;
  const maxBatches = options.maxBatches ?? 10;
  let expired = 0;
  let batches = 0;

  for (; batches < maxBatches; batches++) {
    const claimed = await claimExpiredEntitlements(env.DB, limit);
    if (claimed.length === 0) break;

    for (const ent of claimed) {
      const nowIso = new Date().toISOString();
      // Event + assignment release commit together (atomic batch); the claim
      // already guarantees this entitlement is handled once.
      await env.DB.batch([
        subscriptionEventStatement(env.DB, {
          entitlementId: ent.id,
          type: "expire",
          fromStatus: "active",
          toStatus: "expired",
          actor: "system",
          payload: { reason: "ttl_expired", endAt: ent.end_at },
        }),
        releaseEntitlementAssignmentsStatement(env.DB, ent.id, nowIso),
      ]);
      await writeStudioAudit(env, {
        actor: "system",
        action: "subscriptions.expire",
        targetType: "entitlement",
        targetId: String(ent.id),
        metadata: { planId: ent.plan_id, reason: "ttl_expired" },
        ip: null,
      });
      expired += 1;
    }

    if (claimed.length < limit) break; // drained
  }

  return { expired, batches };
}
