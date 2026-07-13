/** API interne — salons vocaux temporaires (registre écrit par la gateway). */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { requireInternalModule } from "./module-guard.js";
import {
  countTempVoiceChannels,
  deleteTempVoiceChannel,
  disableTempVoice,
  insertTempVoiceChannel,
  listAllTempVoiceChannels,
  listTempVoiceChannels,
} from "../db/queries.js";

export const internalTempVoiceRouter = new Hono<{ Bindings: Env }>();
internalTempVoiceRouter.use("/internal/guilds/:guildId/temp-voice/*", requireInternalModule("temp_voice"));

const SNOWFLAKE = /^\d{5,20}$/;

/** Reconciliation at gateway startup: every registered temp channel, all guilds. */
internalTempVoiceRouter.get("/internal/temp-voice/channels", async (c) => {
  const rows = await listAllTempVoiceChannels(c.env.DB);
  return c.json({
    channels: rows.map((r) => ({ channelId: r.channel_id, guildId: r.guild_id, ownerId: r.owner_id })),
  });
});

/** Per-guild list + count (the gateway checks the count before creating). */
internalTempVoiceRouter.get("/internal/guilds/:guildId/temp-voice/channels", async (c) => {
  const guildId = c.req.param("guildId");
  const rows = await listTempVoiceChannels(c.env.DB, guildId);
  return c.json({
    count: rows.length,
    channels: rows.map((r) => ({ channelId: r.channel_id, ownerId: r.owner_id })),
  });
});

const registerSchema = z.object({
  channelId: z.string().regex(SNOWFLAKE),
  ownerId: z.string().regex(SNOWFLAKE),
});

internalTempVoiceRouter.post("/internal/guilds/:guildId/temp-voice/channels", async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await insertTempVoiceChannel(c.env.DB, c.req.param("guildId"), parsed.data.channelId, parsed.data.ownerId);
  const count = await countTempVoiceChannels(c.env.DB, c.req.param("guildId"));
  return c.json({ ok: true, count }, 201);
});

internalTempVoiceRouter.delete("/internal/guilds/:guildId/temp-voice/channels/:channelId", async (c) => {
  await deleteTempVoiceChannel(c.env.DB, c.req.param("guildId"), c.req.param("channelId"));
  return c.json({ ok: true });
});

/** The trigger (lobby) channel was deleted manually → disable + clear its reference. */
internalTempVoiceRouter.post("/internal/guilds/:guildId/temp-voice/lobby-deleted", async (c) => {
  await disableTempVoice(c.env.DB, c.req.param("guildId"), { clearLobby: true });
  return c.json({ ok: true });
});
