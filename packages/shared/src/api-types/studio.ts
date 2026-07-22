/** Developer Studio DTOs (M12). The permission catalog is the security frontier:
 * every /studio-api/* route is gated server-side by requireDeveloper(permission).
 * The client is never trusted — these types only mirror what the server enforces.
 * No PII/secret is ever carried here (guild/subscription views are minimized). */

import type { Paginated } from "./common.js";
import type { PlanId } from "../entitlement.js";

/**
 * The 13 granular developer permissions (doc 09 §3 matrix). Cumulative but
 * independent: `grant_lifetime` is never implied by `grant`, `refund_paid` never
 * by `cancel_paid`. There is deliberately no `subscriptions.revoke_paid`.
 */
export const STUDIO_PERMISSIONS = [
  "subscriptions.read",
  "subscriptions.grant",
  "subscriptions.grant_lifetime",
  "subscriptions.revoke_granted",
  "subscriptions.cancel_paid",
  "subscriptions.refund_paid",
  "support.manage",
  "guilds.inspect",
  "features.manage",
  "updates.publish",
  "deployments.read",
  "deployments.manage",
  "audit.read",
] as const;

export type StudioPermission = (typeof STUDIO_PERMISSIONS)[number];

const STUDIO_PERMISSION_SET: ReadonlySet<string> = new Set(STUDIO_PERMISSIONS);

/** Validation guard — never widen the permission set from client input. */
export function isStudioPermission(value: unknown): value is StudioPermission {
  return typeof value === "string" && STUDIO_PERMISSION_SET.has(value);
}

/** Identity + effective permissions of the signed-in operator (server-resolved). */
export interface StudioSessionInfo {
  operatorId: string;
  displayName: string | null;
  /** True when granted via the STUDIO_OWNER_IDS bootstrap secret (all permissions). */
  isOwner: boolean;
  permissions: StudioPermission[];
}

export type StudioTicketPriority = "low" | "normal" | "high";

/** Overview KPIs — counts only, no personal data (doc 04 §Vue d'ensemble). */
export interface StudioOverview {
  guilds: number;
  activeEntitlements: number;
  openTickets: Record<StudioTicketPriority, number>;
  latestUpdate: { slug: string; title: string; publishedAt: string } | null;
}

/** Read-only guild row for the Studio table (minimized fields). */
export interface StudioGuildSummary {
  id: string;
  name: string | null;
  botInstalled: boolean;
  createdAt: string;
}

export type StudioGuildsListResponse = Paginated<StudioGuildSummary>;

/** Minimized known-user row, derived only from existing operational tables. */
export interface StudioUserSummary {
  userId: string;
  activeEntitlements: number;
  supportTickets: number;
  lastActivityAt: string;
}

export type StudioUsersListResponse = Paginated<StudioUserSummary>;

/** Read-only entitlement/subscription row (no PII, no billing secrets). */
export interface StudioSubscriptionSummary {
  id: number;
  userId: string;
  planId: PlanId;
  source: string;
  status: string;
  isLifetime: boolean;
  startAt: string;
  endAt: string | null;
}

export type StudioSubscriptionsListResponse = Paginated<StudioSubscriptionSummary>;

/** Cross-user support queue row. Message bodies stay behind a dedicated detail workflow. */
export interface StudioSupportTicketSummary {
  id: number;
  userId: string;
  guildId: string | null;
  planAtOpen: PlanId;
  priority: StudioTicketPriority;
  subject: string;
  status: "open" | "pending" | "resolved" | "closed";
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StudioSupportListResponse = Paginated<StudioSupportTicketSummary>;

export type StudioUpdateStatus = "draft" | "scheduled" | "published" | "archived";

/** Release-note row as seen in the Studio (includes drafts). */
export interface StudioUpdateSummary {
  slug: string;
  version: string | null;
  title: string;
  status: StudioUpdateStatus;
  publishedAt: string | null;
  updatedAt: string;
}

export type StudioUpdatesListResponse = Paginated<StudioUpdateSummary>;

export interface CreateStudioUpdateRequest {
  slug: string;
  title: string;
  version?: string;
  summary?: string;
}
