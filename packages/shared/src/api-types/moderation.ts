/** Moderation log + warning DTOs. */

export interface ModActionDto {
  id: number;
  action: string;
  targetId: string | null;
  moderatorId: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  source: "interaction" | "panel" | "gateway";
  createdAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "revoked" | "failed";
  revokedAt: string | null;
  revokedBy: string | null;
  revocationReason: string | null;
}

export interface WarningDto {
  id: number;
  userId: string;
  moderatorId: string;
  reason: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export const PANEL_SANCTION_TYPES = ["warn", "timeout", "kick", "ban"] as const;
export type PanelSanctionType = (typeof PANEL_SANCTION_TYPES)[number];

export interface SanctionExemptionsDto {
  warn: string[];
  timeout: string[];
  kick: string[];
  ban: string[];
}
