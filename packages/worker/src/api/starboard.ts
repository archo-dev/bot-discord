import { Hono } from "hono";
import { z } from "zod";
import type { StarboardSettingsDto } from "@bot/shared";
import { getStarboardSettings, upsertStarboardSettings, type StarboardSettingsRow } from "../db/queries.js";
import { DiscordAPIError } from "../discord/rest.js";
import { assertChannelsInGuild } from "./welcome.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const starboardRouter = new Hono<AppContext>();

const SNOWFLAKE = /^\d{5,20}$/;

// Defaults mirror the column defaults in 0018_starboard.sql.
export function starboardRowToDto(row: StarboardSettingsRow | null): StarboardSettingsDto {
  return {
    enabled: row ? row.enabled === 1 : false,
    channelId: row?.channel_id ?? null,
    threshold: row?.threshold ?? 3,
    emoji: row?.emoji ?? "⭐",
  };
}

starboardRouter.get("/guilds/:guildId/starboard-settings", async (c) => {
  return c.json(starboardRowToDto(await getStarboardSettings(c.env.DB, c.req.param("guildId"))));
});

const starboardSchema = z.object({
  enabled: z.boolean(),
  channelId: z.string().regex(SNOWFLAKE).nullable(),
  threshold: z.number().int().min(1).max(50),
  emoji: z.string().min(1).max(64),
});

starboardRouter.put("/guilds/:guildId/starboard-settings", rateLimit({ name: "starboard", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = starboardSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  try {
    if (!(await assertChannelsInGuild(c.env, guildId, [parsed.data.channelId]))) {
      return c.json({ error: "channel_not_in_guild" }, 400);
    }
  } catch (err) {
    if (err instanceof DiscordAPIError) return c.json({ error: "channel_not_in_guild" }, 400);
    throw err;
  }
  await upsertStarboardSettings(c.env.DB, guildId, parsed.data);
  return c.json(starboardRowToDto(await getStarboardSettings(c.env.DB, guildId)));
});
