/** API interne — lecture de la config par guilde et des commandes custom (cache 60 s côté gateway). */

import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  getAutomodSettings,
  getGuild,
  getLogSettings,
  getStarboardSettings,
  getTempVoiceSettings,
  getWelcomeSettings,
  getXpSettings,
  isGuildModuleEnabled,
  listAutoRoles,
  listCustomCommands,
  listEffectiveGuildModules,
  listEnabledAutomationTriggerTypes,
} from "../db/queries.js";
import { logRowToDto, welcomeRowToDto } from "../api/welcome.js";
import { automodRowToDto } from "../api/automod.js";

export const internalConfigRouter = new Hono<{ Bindings: Env }>();

internalConfigRouter.get("/internal/guilds/:guildId/config", async (c) => {
  const guildId = c.req.param("guildId");
  // M04: aucune de ces lectures ne dépend d'une autre — un seul aller-retour D1
  // parallèle au lieu de ~8 séquentiels. La réponse (contrat gateway) est
  // strictement identique à l'ancienne construction séquentielle.
  const [guild, autoRoles, moduleRows, welcomeRow, logRow, automodRow, xpRow, starboardRow, tempVoiceRow, automationTriggers] =
    await Promise.all([
      getGuild(c.env.DB, guildId),
      listAutoRoles(c.env.DB, guildId),
      listEffectiveGuildModules(c.env.DB, guildId),
      getWelcomeSettings(c.env.DB, guildId),
      getLogSettings(c.env.DB, guildId),
      getAutomodSettings(c.env.DB, guildId),
      getXpSettings(c.env.DB, guildId),
      getStarboardSettings(c.env.DB, guildId),
      getTempVoiceSettings(c.env.DB, guildId),
      listEnabledAutomationTriggerTypes(c.env.DB, guildId),
    ]);
  if (!guild) return c.json({ error: "not_found" }, 404);

  const modules: Record<string, { enabled: boolean; configVersion: number }> = Object.fromEntries(
    moduleRows.map((row) => [row.module_id, { enabled: row.enabled === 1, configVersion: row.config_version }]),
  );
  const enabled = (id: string) => modules[id]?.enabled === true;
  return c.json({
    governanceVersion: 1,
    modules,
    id: guild.id,
    logChannelId: guild.log_channel_id,
    warnThreshold: guild.warn_threshold,
    warnTimeoutMinutes: guild.warn_timeout_minutes,
    mentionCards: guild.mention_cards === 1,
    autoRoles: enabled("welcome") ? autoRoles.filter((r) => r.enabled === 1).map((r) => r.role_id) : [],
    welcome: { ...welcomeRowToDto(welcomeRow), moduleEnabled: enabled("welcome") },
    logs: logRowToDto(logRow),
    automod: { ...automodRowToDto(automodRow), moduleEnabled: enabled("automod") },
    xp: {
      enabled: enabled("levels") && (xpRow ? xpRow.enabled === 1 : false),
      cooldownSeconds: xpRow?.cooldown_seconds ?? 60,
      voiceEnabled: xpRow ? xpRow.voice_enabled === 1 : false,
    },
    starboard: {
      enabled: enabled("starboard") && (starboardRow ? starboardRow.enabled === 1 : false),
      channelId: starboardRow?.channel_id ?? null,
      threshold: starboardRow?.threshold ?? 3,
      emoji: starboardRow?.emoji ?? "⭐",
    },
    tempVoice: {
      enabled: enabled("temp_voice") && (tempVoiceRow ? tempVoiceRow.enabled === 1 : false),
      lobbyChannelId: tempVoiceRow?.lobby_channel_id ?? null,
      categoryId: tempVoiceRow?.category_id ?? null,
      nameTemplate: tempVoiceRow?.name_template ?? "🎧・{user}",
      userLimit: tempVoiceRow?.user_limit ?? 0,
      maxChannels: tempVoiceRow?.max_channels ?? 10,
    },
    automationTriggers: enabled("automations") ? automationTriggers : [],
  });
});

internalConfigRouter.get("/internal/guilds/:guildId/commands", async (c) => {
  const guildId = c.req.param("guildId");
  if (!(await isGuildModuleEnabled(c.env.DB, guildId, "custom_commands"))) return c.json([]);
  const trigger = c.req.query("trigger");
  const rows = await listCustomCommands(c.env.DB, guildId);
  const filtered = rows.filter((r) => r.enabled === 1 && (trigger ? r.trigger_type === trigger : true));
  return c.json(filtered.map((r) => ({ id: r.id, name: r.name, triggerType: r.trigger_type, logic: JSON.parse(r.logic) as unknown })));
});
