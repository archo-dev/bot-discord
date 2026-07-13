import type { PanelCapability, PanelGuildAccess } from "../security.js";

export type AdminAuditOutcome = "success" | "error";
export type AdminAuditMethod = "POST" | "PUT" | "PATCH" | "DELETE";
export type AdminAuditTargetType = "command" | "warning" | "button_role" | null;

/** Minimal administrative history. It deliberately contains no Discord content or request payload. */
export interface AdminAuditEntryDto {
  id: number;
  actorId: string;
  actorAccess: PanelGuildAccess;
  capability: PanelCapability;
  method: AdminAuditMethod;
  targetType: AdminAuditTargetType;
  targetId: string | null;
  outcome: AdminAuditOutcome;
  status: number;
  requestId: string;
  createdAt: string;
}

/** Keyset-paginated audit page; `nextCursor` is null on the last page. */
export interface AdminAuditPage {
  items: AdminAuditEntryDto[];
  nextCursor: string | null;
  retentionDays: 90;
}
