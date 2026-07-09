import { Hono } from "hono";
import { z } from "zod";
import type { Paginated, TicketDto, TicketSettingsDto } from "@bot/shared";
import {
  getTicketById,
  getTicketSettings,
  listTickets,
  setTicketPanelMessage,
  upsertTicketSettings,
} from "../db/queries.js";
import { discordJson, DiscordAPIError } from "../discord/rest.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const ticketsRouter = new Hono<AppContext>();

const SNOWFLAKE = /^\d{5,20}$/;

function toSettingsDto(row: Awaited<ReturnType<typeof getTicketSettings>>): TicketSettingsDto {
  let staffRoleIds: string[] = [];
  try {
    const parsed = row ? (JSON.parse(row.staff_role_ids) as unknown) : [];
    if (Array.isArray(parsed)) staffRoleIds = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    /* schéma garanti côté écriture ; une valeur illisible redevient [] */
  }
  return {
    enabled: row?.enabled === 1,
    categoryId: row?.category_id ?? null,
    staffRoleIds,
    transcriptChannelId: row?.transcript_channel_id ?? null,
    panelChannelId: row?.panel_channel_id ?? null,
    panelMessageId: row?.panel_message_id ?? null,
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
});

ticketsRouter.put(
  "/guilds/:guildId/tickets/settings",
  rateLimit({ name: "tickets-settings", limit: 20 }),
  async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    await upsertTicketSettings(c.env.DB, c.req.param("guildId"), parsed.data);
    return c.json({ ok: true });
  },
);

const publishSchema = z.object({
  channelId: z.string().regex(SNOWFLAKE),
  title: z.string().min(1).max(256).default("Support"),
  description: z.string().min(1).max(2000).default("Besoin d'aide ? Ouvrez un ticket et le staff vous répondra."),
});

ticketsRouter.post(
  "/guilds/:guildId/tickets/panel",
  rateLimit({ name: "tickets-panel", limit: 10 }),
  async (c) => {
    const guildId = c.req.param("guildId");
    const parsed = publishSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    const settings = await getTicketSettings(c.env.DB, guildId);
    if (!settings?.category_id) return c.json({ error: "not_configured" }, 400);

    try {
      // Le salon doit appartenir à cette guilde (jamais confiance au client).
      const channel = await discordJson<{ id: string; guild_id?: string }>(c.env, "GET", `/channels/${parsed.data.channelId}`);
      if (channel.guild_id !== guildId) return c.json({ error: "channel_not_in_guild" }, 400);

      const message = await discordJson<{ id: string }>(c.env, "POST", `/channels/${parsed.data.channelId}/messages`, {
        embeds: [{ title: `🎫 ${parsed.data.title}`, description: parsed.data.description, color: 0x5865f2 }],
        components: [
          {
            type: 1,
            components: [{ type: 2, style: 1, label: "Ouvrir un ticket", custom_id: "ticket:open", emoji: { name: "🎫" } }],
          },
        ],
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
  const statusParam = c.req.query("status");
  const status = statusParam === "open" || statusParam === "closed" ? statusParam : undefined;

  const { rows, total } = await listTickets(c.env.DB, guildId, { page, pageSize: 25, status });
  const body: Paginated<TicketDto> = {
    items: rows.map((r) => ({
      id: r.id,
      number: r.number,
      channelId: r.channel_id,
      userId: r.user_id,
      status: r.status,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      closedBy: r.closed_by,
      closeReason: r.close_reason,
      hasTranscript: r.transcript !== null,
    })),
    total,
    page,
    pageSize: 25,
  };
  return c.json(body);
});

ticketsRouter.get("/guilds/:guildId/tickets/:ticketId/transcript", async (c) => {
  const ticketId = Number(c.req.param("ticketId"));
  if (!Number.isInteger(ticketId)) return c.json({ error: "not_found" }, 404);
  const ticket = await getTicketById(c.env.DB, c.req.param("guildId"), ticketId);
  if (!ticket?.transcript) return c.json({ error: "not_found" }, 404);
  return c.json({ number: ticket.number, transcript: ticket.transcript });
});
