import { Hono } from "hono";
import { z } from "zod";
import { levelFromXp } from "@bot/shared";
import type { LeaderboardEntry, XpRewardDto, XpSettingsDto } from "@bot/shared";
import { getXpSettings, listXpLeaderboard, upsertXpSettings, type XpSettingsRow } from "../db/queries.js";
import { DiscordAPIError } from "../discord/rest.js";
import { assertChannelsInGuild } from "./welcome.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const xpRouter = new Hono<AppContext>();

const SNOWFLAKE = /^\d{5,20}$/;

// Defaults mirror the column defaults in 0010_xp.sql.
export function xpRowToDto(row: XpSettingsRow | null): XpSettingsDto {
  return {
    enabled: row ? row.enabled === 1 : false,
    xpMin: row?.xp_min ?? 15,
    xpMax: row?.xp_max ?? 25,
    cooldownSeconds: row?.cooldown_seconds ?? 60,
    announceLevelUp: row ? row.announce_level_up === 1 : true,
    announceChannelId: row?.announce_channel_id ?? null,
    rewards: row ? (JSON.parse(row.rewards) as XpRewardDto[]) : [],
  };
}

xpRouter.get("/guilds/:guildId/xp-settings", async (c) => {
  return c.json(xpRowToDto(await getXpSettings(c.env.DB, c.req.param("guildId"))));
});

const xpSchema = z
  .object({
    enabled: z.boolean(),
    xpMin: z.number().int().min(1).max(100),
    xpMax: z.number().int().min(1).max(200),
    cooldownSeconds: z.number().int().min(5).max(3600),
    announceLevelUp: z.boolean(),
    announceChannelId: z.string().regex(SNOWFLAKE).nullable(),
    rewards: z
      .array(z.object({ level: z.number().int().min(1).max(200), roleId: z.string().regex(SNOWFLAKE) }))
      .max(25),
  })
  .refine((s) => s.xpMax >= s.xpMin, { message: "xpMax < xpMin" });

xpRouter.put("/guilds/:guildId/xp-settings", rateLimit({ name: "xp", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = xpSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  try {
    if (!(await assertChannelsInGuild(c.env, guildId, [parsed.data.announceChannelId]))) {
      return c.json({ error: "channel_not_in_guild" }, 400);
    }
  } catch (err) {
    if (err instanceof DiscordAPIError) return c.json({ error: "channel_not_in_guild" }, 400);
    throw err;
  }
  await upsertXpSettings(c.env.DB, guildId, parsed.data);
  return c.json(xpRowToDto(await getXpSettings(c.env.DB, guildId)));
});

xpRouter.get("/guilds/:guildId/leaderboard", async (c) => {
  const rows = await listXpLeaderboard(c.env.DB, c.req.param("guildId"), 50);
  const body: LeaderboardEntry[] = rows.map((r, i) => ({
    rank: i + 1,
    userId: r.user_id,
    username: r.username,
    xp: r.xp,
    level: levelFromXp(r.xp),
    messages: r.messages,
  }));
  return c.json(body);
});
