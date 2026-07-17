/** Ticket system settings + bounded M09 team-triage DTOs. */
import { z } from "zod";

export const TICKET_STATES = ["open", "pending", "closed"] as const;
export type TicketState = (typeof TICKET_STATES)[number];

export const TICKET_PRIORITIES = ["normal", "high"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const ticketFormFieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  label: z.string().trim().min(1).max(45),
  style: z.enum(["short", "paragraph"]),
  required: z.boolean(),
  maxLength: z.number().int().min(32).max(1000),
}).strict();

export const ticketCategorySchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  label: z.string().trim().min(1).max(50),
  description: z.string().trim().max(100),
  emoji: z.string().trim().max(16).nullable(),
}).strict();

export const ticketFormConfigSchema = z.object({
  version: z.literal(1),
  categories: z.array(ticketCategorySchema).min(1).max(5),
  fields: z.array(ticketFormFieldSchema).max(3),
}).strict().superRefine((value, ctx) => {
  for (const key of ["categories", "fields"] as const) {
    const seen = new Set<string>();
    value[key].forEach((entry, index) => {
      if (seen.has(entry.id)) ctx.addIssue({ code: "custom", path: [key, index, "id"], message: "duplicate_id" });
      seen.add(entry.id);
    });
  }
});

export type TicketFormConfig = z.infer<typeof ticketFormConfigSchema>;

export const DEFAULT_TICKET_FORM: TicketFormConfig = {
  version: 1,
  categories: [{ id: "general", label: "Demande générale", description: "Contacter l'équipe de support", emoji: "🎫" }],
  fields: [
    { id: "subject", label: "Sujet", style: "short", required: true, maxLength: 120 },
    { id: "details", label: "Détails de la demande", style: "paragraph", required: true, maxLength: 1000 },
  ],
};

export interface TicketSettingsDto {
  enabled: boolean;
  categoryId: string | null;
  staffRoleIds: string[];
  transcriptChannelId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  formEnabled: boolean;
  form: TicketFormConfig;
}

export interface TicketSettingsUpdate {
  enabled: boolean;
  categoryId: string | null;
  staffRoleIds: string[];
  transcriptChannelId: string | null;
  formEnabled: boolean;
  form: TicketFormConfig;
}

export interface TicketDto {
  id: number;
  number: number;
  channelId: string;
  userId: string;
  status: "open" | "closed";
  state: TicketState;
  priority: TicketPriority;
  categoryKey: string | null;
  assigneeId: string | null;
  assignedAt: string | null;
  updatedAt: string;
  formResponse: Record<string, string> | null;
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
  hasTranscript: boolean;
}

export interface TicketEventDto {
  id: number;
  type: "created" | "assigned" | "unassigned" | "state_changed" | "priority_changed" | "closed";
  actorId: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface TicketStatsDto {
  total: number;
  open: number;
  pending: number;
  closed: number;
  unassigned: number;
  highPriority: number;
  aging: number;
  medianAssignMinutes: number | null;
  byCategory: Array<{ categoryKey: string; count: number }>;
}

export type TicketPatchAction =
  | { action: "claim" }
  | { action: "unassign" }
  | { action: "set_state"; state: "open" | "pending" }
  | { action: "set_priority"; priority: TicketPriority };
