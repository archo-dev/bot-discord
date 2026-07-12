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
