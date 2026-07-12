/** Panel access grants + auto-roles DTOs. */

export interface PanelAccessEntry {
  id: number;
  subjectType: "role" | "user";
  subjectId: string;
  /** admin = full access, moderator = read-only panel. */
  level: "admin" | "moderator";
  addedBy: string;
  createdAt: string;
}

export interface AutoRoleEntry {
  roleId: string;
  enabled: boolean;
  /** Applied by the gateway service on member join. */
  gatewayRequired: true;
}
