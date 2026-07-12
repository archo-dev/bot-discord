/** API interne — lecture de la config par guilde et des commandes custom (cache 60 s côté gateway). */

import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  getAutomodSettings,
  getGuild,
  getLogSettings,
  getStarboardSettings,
  getWelcomeSettings,
  getXpSettings,
  listAutoRoles,
  listCustomCommands,
} from "../db/queries.js";
import { logRowToDto, welcomeRowToDto } from "../api/welcome.js";
import { automodRowToDto } from "../api/automod.js";

export const internalConfigRouter = new Hono<{ Bindings: Env }>();

internalConfigRouter.get("/internal/guilds/:guildId/config", async (c) => {
  const guildId = c.req.param("guildId");
  const guild = await getGuild(c.env.DB, guildId);
  if (!guild) return c.json({ error: "not_found" }, 404);
  const autoRoles = await listAutoRoles(c.env.DB, guildId);
  return c.json({
    id: guild.id,
    logChannelId: guild.log_channel_id,
    warnThreshold: guild.warn_threshold,
    warnTimeoutMinutes: guild.warn_timeout_minutes,
    mentionCards: guild.mention_cards === 1,
    autoRoles: autoRoles.filter((r) => r.enabled === 1).map((r) => r.role_id),
    welcome: welcomeRowToDto(await getWelcomeSettings(c.env.DB, guildId)),
    logs: logRowToDto(await getLogSettings(c.env.DB, guildId)),
    automod: automodRowToDto(await getAutomodSettings(c.env.DB, guildId)),
    xp: await (async () => {
      const s = await getXpSettings(c.env.DB, guildId);
      return {
        enabled: s ? s.enabled === 1 : false,
        cooldownSeconds: s?.cooldown_seconds ?? 60,
        voiceEnabled: s ? s.voice_enabled === 1 : false,
      };
    })(),
    starboard: await (async () => {
      const s = await getStarboardSettings(c.env.DB, guildId);
      return {
        enabled: s ? s.enabled === 1 : false,
        channelId: s?.channel_id ?? null,
        threshold: s?.threshold ?? 3,
        emoji: s?.emoji ?? "⭐",
      };
    })(),
  });
});

internalConfigRouter.get("/internal/guilds/:guildId/commands", async (c) => {
  const guildId = c.req.param("guildId");
  const trigger = c.req.query("trigger");
  const rows = await listCustomCommands(c.env.DB, guildId);
  const filtered = rows.filter((r) => r.enabled === 1 && (trigger ? r.trigger_type === trigger : true));
  return c.json(filtered.map((r) => ({ id: r.id, name: r.name, triggerType: r.trigger_type, logic: JSON.parse(r.logic) as unknown })));
});
