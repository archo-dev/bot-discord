import { Hono } from "hono";
import { z } from "zod";
import {
  DEFAULT_TICKET_FORM,
  TICKET_PRIORITIES,
  TICKET_STATES,
  ticketFormConfigSchema,
  type Paginated,
  type TicketDto,
  type TicketEventDto,
  type TicketSettingsDto,
  type TicketStatsDto,
} from "@bot/shared";
import {
  claimTicket,
  getTicketById,
  getTicketSettings,
  getTicketStats,
  listTicketEvents,
  listTickets,
  setTicketPanelMessage,
  setTicketPriority,
  setTicketState,
  unassignTicket,
  upsertTicketSettings,
  type TicketRow,
} from "../db/queries.js";
import { discordJson, DiscordAPIError } from "../discord/rest.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const ticketsRouter = new Hono<AppContext>();

const SNOWFLAKE = /^\d{5,20}$/;

function parseForm(raw: string | null | undefined) {
  if (!raw) return DEFAULT_TICKET_FORM;
  try {
    const parsed = ticketFormConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_TICKET_FORM;
  } catch {
    return DEFAULT_TICKET_FORM;
  }
}

function parseRecord(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return null;
  }
}

function toTicketDto(row: TicketRow): TicketDto {
  return {
    id: row.id,
    number: row.number,
    channelId: row.channel_id,
    userId: row.user_id,
    status: row.status,
    state: row.state,
    priority: row.priority,
    categoryKey: row.category_key,
    assigneeId: row.assignee_id,
    assignedAt: row.assigned_at,
    updatedAt: row.updated_at ?? row.created_at,
    formResponse: parseRecord(row.form_response),
    createdAt: row.created_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    closeReason: row.close_reason,
    hasTranscript: row.transcript !== null,
  };
}

function toSettingsDto(row: Awaited<ReturnType<typeof getTicketSettings>>): TicketSettingsDto {
  let staffRoleIds: string[] = [];
  try {
    const parsed = row ? (JSON.parse(row.staff_role_ids) as unknown) : [];
    if (Array.isArray(parsed)) staffRoleIds = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // An unreadable historic value safely falls back to no staff role.
  }
  return {
    enabled: row?.enabled === 1,
    categoryId: row?.category_id ?? null,
    staffRoleIds,
    transcriptChannelId: row?.transcript_channel_id ?? null,
    panelChannelId: row?.panel_channel_id ?? null,
    panelMessageId: row?.panel_message_id ?? null,
    formEnabled: row?.form_enabled === 1,
    form: parseForm(row?.form_config),
  };
}

ticketsRouter.get("/guilds/:guildId/tickets/settings", async (c) => {
  const row = await getTicketSettings(c.env.DB, c.req.param("guildId"));
  return c.json(toSettingsDto(row));
});

const settingsSchema = z.object({
  enabled: z.boolean(),
  categoryId: z.string().regex(SNOWFLAKE).nullable(),
  staffRoleIds: z.array(z.string().regex(SNOWFLAKE)).max(10),
  transcriptChannelId: z.string().regex(SNOWFLAKE).nullable(),
  formEnabled: z.boolean(),
  form: ticketFormConfigSchema,
}).strict();

ticketsRouter.put(
  "/guilds/:guildId/tickets/settings",
  rateLimit({ name: "tickets-settings", limit: 20 }),
  async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalidBody(c, parsed.error);
    await upsertTicketSettings(c.env.DB, c.req.param("guildId"), parsed.data);
    return c.json({ ok: true });
  },
);

const publishSchema = z.object({
  channelId: z.string().regex(SNOWFLAKE),
  title: z.string().min(1).max(256).default("Support"),
  description: z.string().min(1).max(2000).default("Besoin d'aide ? Ouvrez un ticket et le staff vous répondra."),
}).strict();

ticketsRouter.post(
  "/guilds/:guildId/tickets/panel",
  rateLimit({ name: "tickets-panel", limit: 10 }),
  async (c) => {
    const guildId = c.req.param("guildId");
    const parsed = publishSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalidBody(c, parsed.error);

    const settings = await getTicketSettings(c.env.DB, guildId);
    if (!settings?.category_id) return c.json({ error: "not_configured" }, 400);
    const form = parseForm(settings.form_config);
    const opener = settings.form_enabled === 1
      ? form.categories.length === 1
        ? { type: 2, style: 1, label: "Ouvrir un ticket", custom_id: `ticket:open:v2:${form.categories[0]!.id}`, emoji: { name: "🎫" } }
        : {
            type: 3,
            custom_id: "ticket:open:v2",
            placeholder: "Choisir une catégorie…",
            min_values: 1,
            max_values: 1,
            options: form.categories.map((category) => ({
              label: category.label,
              value: category.id,
              description: category.description || undefined,
              emoji: category.emoji ? { name: category.emoji } : undefined,
            })),
          }
      : { type: 2, style: 1, label: "Ouvrir un ticket", custom_id: "ticket:open", emoji: { name: "🎫" } };

    try {
      const channel = await discordJson<{ id: string; guild_id?: string }>(c.env, "GET", `/channels/${parsed.data.channelId}`);
      if (channel.guild_id !== guildId) return c.json({ error: "channel_not_in_guild" }, 400);
      const message = await discordJson<{ id: string }>(c.env, "POST", `/channels/${parsed.data.channelId}/messages`, {
        embeds: [{ title: `🎫 ${parsed.data.title}`, description: parsed.data.description, color: 0x5865f2 }],
        components: [{ type: 1, components: [opener] }],
      });
      await setTicketPanelMessage(c.env.DB, guildId, parsed.data.channelId, message.id);
      return c.json({ ok: true, messageId: message.id });
    } catch (err) {
      if (err instanceof DiscordAPIError) return c.json({ error: "discord_error", detail: err.message }, 502);
      throw err;
    }
  },
);

ticketsRouter.get("/guilds/:guildId/tickets", async (c) => {
  const guildId = c.req.param("guildId");
  const page = Math.max(Number(c.req.query("page") ?? "1") || 1, 1);
  const stateParam = c.req.query("state") ?? c.req.query("status");
  const state = TICKET_STATES.find((value) => value === stateParam);
  const priorityParam = c.req.query("priority");
  const priority = TICKET_PRIORITIES.find((value) => value === priorityParam);
  const assigneeParam = c.req.query("assignee");
  const assigneeId = assigneeParam === "unassigned" || (assigneeParam && SNOWFLAKE.test(assigneeParam)) ? assigneeParam : undefined;
  const { rows, total } = await listTickets(c.env.DB, guildId, { page, pageSize: 25, state, priority, assigneeId });
  const body: Paginated<TicketDto> = { items: rows.map(toTicketDto), total, page, pageSize: 25 };
  return c.json(body);
});

ticketsRouter.get("/guilds/:guildId/tickets/stats", async (c) => {
  const body: TicketStatsDto = await getTicketStats(c.env.DB, c.req.param("guildId"));
  return c.json(body);
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }).strict(),
  z.object({ action: z.literal("unassign") }).strict(),
  z.object({ action: z.literal("set_state"), state: z.enum(["open", "pending"]) }).strict(),
  z.object({ action: z.literal("set_priority"), priority: z.enum(TICKET_PRIORITIES) }).strict(),
]);

ticketsRouter.patch(
  "/guilds/:guildId/tickets/:ticketId",
  rateLimit({ name: "tickets-triage", limit: 60 }),
  async (c) => {
    const guildId = c.req.param("guildId");
    const ticketId = Number(c.req.param("ticketId"));
    if (!Number.isSafeInteger(ticketId) || ticketId < 1) return c.json({ error: "not_found" }, 404);
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalidBody(c, parsed.error);
    const actorId = c.get("session").userId;
    let ticket: TicketRow | null = null;
    if (parsed.data.action === "claim") {
      const result = await claimTicket(c.env.DB, guildId, ticketId, actorId);
      if (result.outcome === "conflict") return c.json({ error: "already_assigned" }, 409);
      ticket = result.ticket;
    } else if (parsed.data.action === "unassign") {
      ticket = await unassignTicket(c.env.DB, guildId, ticketId, actorId);
    } else if (parsed.data.action === "set_state") {
      ticket = await setTicketState(c.env.DB, guildId, ticketId, actorId, parsed.data.state);
    } else {
      ticket = await setTicketPriority(c.env.DB, guildId, ticketId, actorId, parsed.data.priority);
    }
    if (!ticket) return c.json({ error: "not_found_or_closed" }, 404);
    return c.json(toTicketDto(ticket));
  },
);

ticketsRouter.get("/guilds/:guildId/tickets/:ticketId/events", async (c) => {
  const guildId = c.req.param("guildId");
  const ticketId = Number(c.req.param("ticketId"));
  if (!Number.isSafeInteger(ticketId) || !(await getTicketById(c.env.DB, guildId, ticketId))) {
    return c.json({ error: "not_found" }, 404);
  }
  const rows = await listTicketEvents(c.env.DB, guildId, ticketId);
  const body: TicketEventDto[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    actorId: row.actor_id,
    fromValue: row.from_value,
    toValue: row.to_value,
    createdAt: row.created_at,
  }));
  return c.json(body);
});

ticketsRouter.get("/guilds/:guildId/tickets/:ticketId/transcript", async (c) => {
  const ticketId = Number(c.req.param("ticketId"));
  if (!Number.isSafeInteger(ticketId)) return c.json({ error: "not_found" }, 404);
  const ticket = await getTicketById(c.env.DB, c.req.param("guildId"), ticketId);
  if (!ticket?.transcript) return c.json({ error: "not_found" }, 404);
  return c.json({ number: ticket.number, transcript: ticket.transcript });
});
