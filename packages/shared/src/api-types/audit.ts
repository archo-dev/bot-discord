/** Studio audit DTOs (M14). The immutable operator audit journal is read-only on
 * the client type surface — masking of secrets/PII happens server-side before a
 * row is ever written. No mutation shape exists: audit_events is append-only. */

import type { Paginated } from "./common.js";

export interface StudioAuditEvent {
  id: number;
  /** 'operator:<id>' or 'system'. */
  actor: string;
  /** The action/permission, e.g. 'subscriptions.grant_lifetime'. */
  action: string;
  targetType: string | null;
  targetId: string | null;
  /** Contextual metadata, already masked server-side (never raw secrets/PII). */
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type StudioAuditPage = Paginated<StudioAuditEvent>;

export interface StudioAuditFilters {
  actor?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
}
