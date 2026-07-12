/** Ticket system settings + ticket DTOs. */

export interface TicketSettingsDto {
  enabled: boolean;
  categoryId: string | null;
  staffRoleIds: string[];
  transcriptChannelId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
}

export interface TicketSettingsUpdate {
  enabled: boolean;
  categoryId: string | null;
  staffRoleIds: string[];
  transcriptChannelId: string | null;
}

export interface TicketDto {
  id: number;
  number: number;
  channelId: string;
  userId: string;
  status: "open" | "closed";
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
  hasTranscript: boolean;
}
