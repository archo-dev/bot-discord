/** Subscription read DTO (M6). Response of GET /api/subscription — the effective
 * plan of the session user (default Gratuit). Read-only, user-scoped, no billing
 * and no internal origin details. `source=null` means the implicit free default. */

import type { EntitlementSource, EntitlementStatus, PlanId } from "../entitlement.js";
import type { AssignmentState } from "../assignments.js";

export interface SubscriptionResponse {
  planId: PlanId;
  planRank: number;
  displayName: string;
  /** Server slots derived from the effective plan (1/3/5). */
  slots: number;
  /** Origin of the effective entitlement; `null` when it is the free default. */
  source: EntitlementSource | null;
  status: EntitlementStatus | null;
  isLifetime: boolean;
  /** ISO 8601 end of the window, or null (free default / lifetime). */
  endAt: string | null;
  /** Whether the platform.entitlements flag is on (panel awareness). */
  entitlementsEnabled: boolean;
}

/** One server slot occupied by (or suspended under) the user's entitlement. */
export interface SlotAssignment {
  guildId: string;
  state: AssignmentState;
  /** ISO 8601 assignment time. */
  assignedAt: string;
}

/** GET /api/subscription/assignments — the user's slots and their occupancy. */
export interface SubscriptionAssignmentsResponse {
  planId: PlanId;
  /** Total slots of the effective plan (1/3/5). */
  slots: number;
  /** Active (live) assignments consuming a slot. */
  used: number;
  /** Free slots = slots - used (never negative). */
  available: number;
  assignments: SlotAssignment[];
  entitlementsEnabled: boolean;
}

/** Effective plan of a single guild, surfaced to the gateway config. */
export interface GuildPlan {
  id: PlanId;
  rank: number;
  slots: number;
}
