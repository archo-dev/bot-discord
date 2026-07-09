import { Hono } from "hono";
import { z } from "zod";
import type { ButtonRoleMessageDto } from "@bot/shared";
import {
  deleteButtonRoleMessage,
  getButtonRoleMessage,
  insertButtonRole,
  insertButtonRoleMessage,
  listButtonRoleMessages,
  listButtonRolesForMessage,
  setButtonRoleMessageId,
} from "../db/queries.js";
import { discordJson, discordRequest, DiscordAPIError } from "../discord/rest.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const buttonRolesRouter = new Hono<AppContext>();

const SNOWFLAKE = /^\d{5,20}$/;

async function toDto(db: D1Database, row: NonNullable<Awaited<ReturnType<typeof getButtonRoleMessage>>>): Promise<ButtonRoleMessageDto> {
  const buttons = await listButtonRolesForMessage(db, row.id);
  return {
    id: row.id,
    channelId: row.channel_id,
    messageId: row.message_id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    buttons: buttons.map((b) => ({ id: b.id, roleId: b.role_id, label: b.label, emoji: b.emoji, style: b.style })),
  };
}

buttonRolesRouter.get("/guilds/:guildId/button-roles", async (c) => {
  const rows = await listButtonRoleMessages(c.env.DB, c.req.param("guildId"));
  const body = await Promise.all(rows.map((r) => toDto(c.env.DB, r)));
  return c.json(body);
});

const createSchema = z.object({
  channelId: z.string().regex(SNOWFLAKE),
  title: z.string().min(1).max(256),
  description: z.string().max(2000).nullable(),
  buttons: z
    .array(
      z.object({
        roleId: z.string().regex(SNOWFLAKE),
        label: z.string().min(1).max(80),
        emoji: z.string().max(8).nullable(),
        style: z.number().int().min(1).max(4),
      }),
    )
    .min(1)
    .max(25),
});

buttonRolesRouter.post("/guilds/:guildId/button-roles", rateLimit({ name: "button-roles", limit: 10 }), async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const input = parsed.data;

  try {
    // Le salon doit appartenir à cette guilde (jamais confiance au client).
    const channel = await discordJson<{ id: string; guild_id?: string }>(c.env, "GET", `/channels/${input.channelId}`);
    if (channel.guild_id !== guildId) return c.json({ error: "channel_not_in_guild" }, 400);

    const messageRef = await insertButtonRoleMessage(c.env.DB, {
      guildId,
      channelId: input.channelId,
      title: input.title,
      description: input.description,
    });
    const buttonIds: number[] = [];
    for (const [i, btn] of input.buttons.entries()) {
      buttonIds.push(
        await insertButtonRole(c.env.DB, {
          messageRef,
          guildId,
          roleId: btn.roleId,
          label: btn.label,
          emoji: btn.emoji,
          style: btn.style,
          position: i,
        }),
      );
    }

    // 5 boutons max par action row, 5 rows max (25 boutons).
    const rows: Array<{ type: 1; components: unknown[] }> = [];
    input.buttons.forEach((btn, i) => {
      if (i % 5 === 0) rows.push({ type: 1, components: [] });
      rows[rows.length - 1]!.components.push({
        type: 2,
        style: btn.style,
        label: btn.label,
        custom_id: `brole:${buttonIds[i]}`,
        ...(btn.emoji ? { emoji: { name: btn.emoji } } : {}),
      });
    });

    try {
      const message = await discordJson<{ id: string }>(c.env, "POST", `/channels/${input.channelId}/messages`, {
        embeds: [{ title: input.title, description: input.description ?? undefined, color: 0x5865f2 }],
        components: rows,
      });
      await setButtonRoleMessageId(c.env.DB, messageRef, message.id);
    } catch (err) {
      await deleteButtonRoleMessage(c.env.DB, guildId, messageRef); // rollback
      throw err;
    }

    const created = await getButtonRoleMessage(c.env.DB, guildId, messageRef);
    return c.json(await toDto(c.env.DB, created!), 201);
  } catch (err) {
    if (err instanceof DiscordAPIError) return c.json({ error: "discord_error", detail: err.message }, 502);
    throw err;
  }
});

buttonRolesRouter.delete("/guilds/:guildId/button-roles/:id", rateLimit({ name: "button-roles", limit: 10 }), async (c) => {
  const guildId = c.req.param("guildId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "not_found" }, 404);
  const row = await getButtonRoleMessage(c.env.DB, guildId, id);
  if (!row) return c.json({ error: "not_found" }, 404);

  if (row.message_id) {
    // Message déjà supprimé à la main ? On tolère et on nettoie la base.
    await discordRequest(c.env, "DELETE", `/channels/${row.channel_id}/messages/${row.message_id}`);
  }
  await deleteButtonRoleMessage(c.env.DB, guildId, id);
  return c.json({ ok: true });
});
