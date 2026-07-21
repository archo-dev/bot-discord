/** Client support DTOs (M11). Read/write surface for a user's own tickets.
 * Priority is DERIVED from the effective plan at open (never client-supplied),
 * frozen thereafter. Internal operator notes and the assignee are NEVER exposed
 * to the client. */

import type { PlanId } from "../entitlement.js";
import type { Paginated } from "./common.js";

export type SupportPriority = "low" | "normal" | "high";
export type SupportTicketStatus = "open" | "pending" | "resolved" | "closed";
/** Coarse author role shown to the client — never the operator id. */
export type SupportMessageAuthor = "user" | "operator" | "system";

/** Support priority derived from the effective plan (pure, backend truth). */
export function supportPriorityForPlan(planId: PlanId): SupportPriority {
  switch (planId) {
    case "business":
      return "high";
    case "premium":
      return "normal";
    default:
      return "low";
  }
}

export interface SupportTicketSummary {
  id: number;
  subject: string;
  status: SupportTicketStatus;
  /** Frozen at open. */
  priority: SupportPriority;
  planAtOpen: PlanId;
  /** Optional context label set by the user; no guild data is exposed. */
  guildId: string | null;
  /** True when the user's current effective plan differs from plan at open. */
  planChangedSinceOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessageView {
  id: number;
  author: SupportMessageAuthor;
  body: string;
  createdAt: string;
}

export interface SupportTicketDetail extends SupportTicketSummary {
  /** Non-internal messages only. */
  messages: SupportMessageView[];
}

export type SupportTicketsListResponse = Paginated<SupportTicketSummary>;

export interface CreateSupportTicketRequest {
  subject: string;
  body: string;
  guildId?: string;
}

export interface CreateSupportMessageRequest {
  body: string;
}
