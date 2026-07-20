/** Subscription read DTO (M6). Response of GET /api/subscription — the effective
 * plan of the session user (default Gratuit). Read-only, user-scoped, no billing
 * and no internal origin details. `source=null` means the implicit free default. */

import type { EntitlementSource, EntitlementStatus, PlanId } from "../entitlement.js";

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
