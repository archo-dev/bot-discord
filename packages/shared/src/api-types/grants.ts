/** Developer grants DTOs (M13). The grant window resolution is PURE and
 * deterministic (same inputs → same output) so it is testable without D1 and can
 * never drift between worker and studio. Lifetime is the only kind with no end.
 * Revocability derives from entitlements.source (never stored) — see doc 06/08. */

import type { Paginated } from "./common.js";
import type { EntitlementLifecycleState, EntitlementOriginKind } from "../entitlement.js";

/**
 * Origine d'un grant temporaire (OPTION A early access). `standard` = accès offert
 * classique (`origin_ref = <grantId>`) ; `early_access` = accès bêta
 * (`origin_ref = 'early_access'`). Jamais une nouvelle valeur d'enum D1.
 */
export const GRANT_ORIGINS = ["standard", "early_access"] as const;
export type GrantOrigin = (typeof GRANT_ORIGINS)[number];

/** Grant durations (doc 06/08). `lifetime` is the only open-ended kind. */
export const GRANT_DURATION_KINDS = ["7d", "30d", "3m", "6m", "1y", "custom", "lifetime"] as const;
export type GrantDurationKind = (typeof GRANT_DURATION_KINDS)[number];

/** Plans that can be granted (never `free` — a grant always raises access). */
export const GRANTABLE_PLANS = ["premium", "business"] as const;
export type GrantablePlan = (typeof GRANTABLE_PLANS)[number];

/** Resolved validity window of a grant. `endAt=null` ⇔ lifetime. */
export interface GrantWindow {
  endAt: string | null;
  isLifetime: boolean;
}

function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const targetMonth = r.getUTCMonth() + months;
  r.setUTCMonth(targetMonth);
  return r;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/**
 * Pure grant-window resolver. `startAtISO` anchors relative durations; `custom`
 * requires `customEndAtISO`. Throws on an invalid/missing custom end so the API
 * layer surfaces a 400 rather than persisting a broken window.
 */
export function resolveGrantWindow(
  kind: GrantDurationKind,
  startAtISO: string,
  customEndAtISO?: string | null,
): GrantWindow {
  if (kind === "lifetime") return { endAt: null, isLifetime: true };
  const start = new Date(startAtISO);
  if (Number.isNaN(start.getTime())) throw new Error("invalid_start_at");
  let end: Date;
  switch (kind) {
    case "7d": end = addDays(start, 7); break;
    case "30d": end = addDays(start, 30); break;
    case "3m": end = addMonths(start, 3); break;
    case "6m": end = addMonths(start, 6); break;
    case "1y": end = addMonths(start, 12); break;
    case "custom": {
      if (!customEndAtISO) throw new Error("custom_end_required");
      end = new Date(customEndAtISO);
      if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) throw new Error("invalid_custom_end");
      break;
    }
  }
  return { endAt: end.toISOString(), isLifetime: false };
}

export interface GrantSummary {
  grantId: number;
  entitlementId: number;
  userId: string;
  planId: GrantablePlan;
  durationKind: GrantDurationKind;
  isLifetime: boolean;
  /** Raw stored status of the backing entitlement. */
  status: string;
  /** Derived lifecycle state (scheduled/active/expired/…), the truth for display. */
  effectiveState: EntitlementLifecycleState;
  /** Clarified origin — `early_access` when the grant is a beta access. */
  originKind: EntitlementOriginKind;
  reason: string;
  grantedBy: string;
  createdAt: string;
  startAt: string;
  revokedAt: string | null;
  endAt: string | null;
}

export type GrantsListResponse = Paginated<GrantSummary>;

export interface CreateGrantRequest {
  userId: string;
  planId: GrantablePlan;
  durationKind: Exclude<GrantDurationKind, "lifetime">;
  /** Required only when durationKind === 'custom'. */
  customEndAt?: string;
  /** Beta vs standard offered access (OPTION A). Defaults to `standard`. */
  origin?: GrantOrigin;
  reason: string;
  internalNote?: string;
}

export interface CreateLifetimeGrantRequest {
  userId: string;
  planId: GrantablePlan;
  reason: string;
  internalNote?: string;
  /** Anti-error explicit typing — must equal "LIFETIME". */
  confirm: string;
}

export interface RevokeGrantRequest {
  reason?: string;
}
