import { Hono } from "hono";
import { z } from "zod";
import type { AutomodSettingsDto } from "@bot/shared";
import { getAutomodSettings, upsertAutomodSettings, type AutomodSettingsRow } from "../db/queries.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const automodRouter = new Hono<AppContext>();

const SNOWFLAKE = /^\d{5,20}$/;

// Defaults mirror the column defaults in 0009_automod.sql.
export function automodRowToDto(row: AutomodSettingsRow | null): AutomodSettingsDto {
  return {
    antiSpamEnabled: row ? row.anti_spam_enabled === 1 : false,
    antiSpamMaxMessages: row?.anti_spam_max_messages ?? 5,
    antiSpamWindowSeconds: row?.anti_spam_window_seconds ?? 5,
    antiInviteEnabled: row ? row.anti_invite_enabled === 1 : false,
    antiLinkEnabled: row ? row.anti_link_enabled === 1 : false,
    linkWhitelist: row ? (JSON.parse(row.link_whitelist) as string[]) : [],
    bannedWords: row ? (JSON.parse(row.banned_words) as string[]) : [],
    exemptRoleIds: row ? (JSON.parse(row.exempt_role_ids) as string[]) : [],
    exemptChannelIds: row ? (JSON.parse(row.exempt_channel_ids) as string[]) : [],
    action: row?.action ?? "delete",
    timeoutMinutes: row?.timeout_minutes ?? 10,
  };
}

automodRouter.get("/guilds/:guildId/automod", async (c) => {
  return c.json(automodRowToDto(await getAutomodSettings(c.env.DB, c.req.param("guildId"))));
});

const DOMAIN = /^[a-z0-9.-]{3,100}$/;

const automodSchema = z.object({
  antiSpamEnabled: z.boolean(),
  antiSpamMaxMessages: z.number().int().min(2).max(20),
  antiSpamWindowSeconds: z.number().int().min(2).max(60),
  antiInviteEnabled: z.boolean(),
  antiLinkEnabled: z.boolean(),
  linkWhitelist: z.array(z.string().toLowerCase().regex(DOMAIN)).max(50),
  bannedWords: z.array(z.string().min(2).max(50)).max(100),
  // Exemptions are only ever compared against ids inside the same guild, so a
  // foreign id is inert — shape validation is enough (no REST round-trips).
  exemptRoleIds: z.array(z.string().regex(SNOWFLAKE)).max(25),
  exemptChannelIds: z.array(z.string().regex(SNOWFLAKE)).max(25),
  action: z.enum(["delete", "warn", "timeout"]),
  timeoutMinutes: z.number().int().min(1).max(40320),
});

automodRouter.put("/guilds/:guildId/automod", rateLimit({ name: "automod", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = automodSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await upsertAutomodSettings(c.env.DB, guildId, parsed.data);
  return c.json(automodRowToDto(await getAutomodSettings(c.env.DB, guildId)));
});
