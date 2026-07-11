import { Hono } from "hono";
import { z } from "zod";
import type { LogSettingsDto, WelcomeSettingsDto } from "@bot/shared";
import {
  getLogSettings,
  getWelcomeSettings,
  upsertLogSettings,
  upsertWelcomeSettings,
  type LogSettingsRow,
  type WelcomeSettingsRow,
} from "../db/queries.js";
import { discordJson, DiscordAPIError } from "../discord/rest.js";
import type { AppContext } from "../auth/guard.js";
import type { Env } from "../env.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const welcomeRouter = new Hono<AppContext>();

const SNOWFLAKE = /^\d{5,20}$/;

// Defaults mirror the column defaults in 0008_welcome_logs.sql, so a guild
// without a row reads the same via the panel API and /internal.
export function welcomeRowToDto(row: WelcomeSettingsRow | null): WelcomeSettingsDto {
  return {
    welcomeEnabled: row ? row.welcome_enabled === 1 : false,
    welcomeChannelId: row?.welcome_channel_id ?? null,
    welcomeMessage: row?.welcome_message ?? "Bienvenue {mention} sur {server} !",
    leaveEnabled: row ? row.leave_enabled === 1 : false,
    leaveChannelId: row?.leave_channel_id ?? null,
    leaveMessage: row?.leave_message ?? "{user} a quitté le serveur.",
  };
}

export function logRowToDto(row: LogSettingsRow | null): LogSettingsDto {
  return {
    channelId: row?.channel_id ?? null,
    memberJoin: row ? row.log_member_join === 1 : false,
    memberLeave: row ? row.log_member_leave === 1 : false,
    messageDelete: row ? row.log_message_delete === 1 : false,
    messageEdit: row ? row.log_message_edit === 1 : false,
    memberUpdate: row ? row.log_member_update === 1 : false,
    voiceJoin: row ? row.log_voice_join === 1 : false,
    voiceLeave: row ? row.log_voice_leave === 1 : false,
    voiceMove: row ? row.log_voice_move === 1 : false,
    voiceState: row ? row.log_voice_state === 1 : false,
  };
}

/** 400s unless every given channel exists and belongs to the guild. */
export async function assertChannelsInGuild(env: Env, guildId: string, channelIds: Array<string | null>): Promise<boolean> {
  for (const id of new Set(channelIds.filter((c): c is string => c !== null))) {
    const channel = await discordJson<{ id: string; guild_id?: string }>(env, "GET", `/channels/${id}`);
    if (channel.guild_id !== guildId) return false;
  }
  return true;
}

welcomeRouter.get("/guilds/:guildId/welcome", async (c) => {
  return c.json(welcomeRowToDto(await getWelcomeSettings(c.env.DB, c.req.param("guildId"))));
});

const welcomeSchema = z.object({
  welcomeEnabled: z.boolean(),
  welcomeChannelId: z.string().regex(SNOWFLAKE).nullable(),
  welcomeMessage: z.string().min(1).max(2000),
  leaveEnabled: z.boolean(),
  leaveChannelId: z.string().regex(SNOWFLAKE).nullable(),
  leaveMessage: z.string().min(1).max(2000),
});

welcomeRouter.put("/guilds/:guildId/welcome", rateLimit({ name: "welcome", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = welcomeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  try {
    if (!(await assertChannelsInGuild(c.env, guildId, [parsed.data.welcomeChannelId, parsed.data.leaveChannelId]))) {
      return c.json({ error: "channel_not_in_guild" }, 400);
    }
  } catch (err) {
    if (err instanceof DiscordAPIError) return c.json({ error: "channel_not_in_guild" }, 400);
    throw err;
  }
  await upsertWelcomeSettings(c.env.DB, guildId, parsed.data);
  return c.json(welcomeRowToDto(await getWelcomeSettings(c.env.DB, guildId)));
});

welcomeRouter.get("/guilds/:guildId/log-settings", async (c) => {
  return c.json(logRowToDto(await getLogSettings(c.env.DB, c.req.param("guildId"))));
});

const logSchema = z.object({
  channelId: z.string().regex(SNOWFLAKE).nullable(),
  memberJoin: z.boolean(),
  memberLeave: z.boolean(),
  messageDelete: z.boolean(),
  messageEdit: z.boolean(),
  memberUpdate: z.boolean(),
  voiceJoin: z.boolean(),
  voiceLeave: z.boolean(),
  voiceMove: z.boolean(),
  voiceState: z.boolean(),
});

welcomeRouter.put("/guilds/:guildId/log-settings", rateLimit({ name: "welcome", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = logSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  try {
    if (!(await assertChannelsInGuild(c.env, guildId, [parsed.data.channelId]))) {
      return c.json({ error: "channel_not_in_guild" }, 400);
    }
  } catch (err) {
    if (err instanceof DiscordAPIError) return c.json({ error: "channel_not_in_guild" }, 400);
    throw err;
  }
  await upsertLogSettings(c.env.DB, guildId, parsed.data);
  return c.json(logRowToDto(await getLogSettings(c.env.DB, guildId)));
});
