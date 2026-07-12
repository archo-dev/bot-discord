import { Hono } from "hono";
import { z } from "zod";
import type { TempVoiceSettingsDto } from "@bot/shared";
import {
  countTempVoiceChannels,
  getTempVoiceSettings,
  upsertTempVoiceSettings,
  type TempVoiceSettingsRow,
} from "../db/queries.js";
import { DiscordAPIError } from "../discord/rest.js";
import { assertChannelsInGuild } from "./welcome.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const tempVoiceRouter = new Hono<AppContext>();

const SNOWFLAKE = /^\d{5,20}$/;

// Defaults mirror the column defaults in 0019_temp_voice.sql.
export function tempVoiceRowToDto(row: TempVoiceSettingsRow | null, activeChannels: number): TempVoiceSettingsDto {
  return {
    enabled: row ? row.enabled === 1 : false,
    lobbyChannelId: row?.lobby_channel_id ?? null,
    categoryId: row?.category_id ?? null,
    nameTemplate: row?.name_template ?? "🎧・{user}",
    userLimit: row?.user_limit ?? 0,
    maxChannels: row?.max_channels ?? 10,
    activeChannels,
  };
}

tempVoiceRouter.get("/guilds/:guildId/temp-voice-settings", async (c) => {
  const guildId = c.req.param("guildId");
  const [row, active] = await Promise.all([
    getTempVoiceSettings(c.env.DB, guildId),
    countTempVoiceChannels(c.env.DB, guildId),
  ]);
  return c.json(tempVoiceRowToDto(row, active));
});

const settingsSchema = z.object({
  enabled: z.boolean(),
  lobbyChannelId: z.string().regex(SNOWFLAKE).nullable(),
  categoryId: z.string().regex(SNOWFLAKE).nullable(),
  nameTemplate: z.string().min(1).max(90),
  userLimit: z.number().int().min(0).max(99),
  maxChannels: z.number().int().min(1).max(25),
});

tempVoiceRouter.put(
  "/guilds/:guildId/temp-voice-settings",
  rateLimit({ name: "temp-voice", limit: 20 }),
  async (c) => {
    const guildId = c.req.param("guildId");
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalidBody(c, parsed.error);
    try {
      if (!(await assertChannelsInGuild(c.env, guildId, [parsed.data.lobbyChannelId, parsed.data.categoryId]))) {
        return c.json({ error: "channel_not_in_guild" }, 400);
      }
    } catch (err) {
      if (err instanceof DiscordAPIError) return c.json({ error: "channel_not_in_guild" }, 400);
      throw err;
    }

    // Preserve the "bot-created lobby" flag only while the lobby channel is unchanged;
    // a panel edit that points at a different channel is a manual (existing) lobby.
    const existing = await getTempVoiceSettings(c.env.DB, guildId);
    const lobbyCreatedByBot =
      existing?.lobby_created_by_bot === 1 && existing.lobby_channel_id === parsed.data.lobbyChannelId;

    await upsertTempVoiceSettings(c.env.DB, guildId, { ...parsed.data, lobbyCreatedByBot });
    const active = await countTempVoiceChannels(c.env.DB, guildId);
    return c.json(tempVoiceRowToDto(await getTempVoiceSettings(c.env.DB, guildId), active));
  },
);
