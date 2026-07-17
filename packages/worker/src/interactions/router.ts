import { Hono, type Context } from "hono";
import {
  ApplicationCommandType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction,
  ComponentType,
} from "discord-api-types/v10";
import { moduleForCommand, type ModuleId } from "@bot/shared";
import type { Env } from "../env.js";
import { verifyDiscordSignature } from "./verify.js";
import { builtins } from "./builtins/index.js";
import { findComponentHandler, findModalHandler, moduleForComponent } from "./components/index.js";
import { ephemeral, pong } from "./respond.js";
import { ensureGuild } from "../db/ensure-guild.js";
import { getEnabledSlashCommand, isGuildModuleEnabled } from "../db/queries.js";
import { executeCustomCommand } from "./custom.js";
import { recordProductMetric } from "../analytics/service.js";
import { emitWorkerAutomationEvent } from "../automation/emit.js";

export const interactionsRouter = new Hono<{ Bindings: Env }>();

async function moduleDisabled(env: Env, guildId: string, moduleId: ModuleId | null): Promise<Response | null> {
  if (!moduleId || await isGuildModuleEnabled(env.DB, guildId, moduleId)) return null;
  return ephemeral("Ce module est désactivé sur ce serveur.");
}

async function trackFeatureResult(
  c: Context<{ Bindings: Env }>,
  guildId: string,
  moduleId: ModuleId | null,
  operation: Promise<Response>,
): Promise<Response> {
  try {
    const response = await operation;
    c.executionCtx.waitUntil(recordProductMetric(c.env, guildId, {
      event: "feature_result", module: moduleId, step: null, outcome: "success",
    }).catch(() => false));
    return response;
  } catch (error) {
    c.executionCtx.waitUntil(recordProductMetric(c.env, guildId, {
      event: "feature_result", module: moduleId, step: null, outcome: "failure",
    }).catch(() => false));
    throw error;
  }
}

interactionsRouter.post("/interactions", async (c) => {
  const signature = c.req.header("x-signature-ed25519");
  const timestamp = c.req.header("x-signature-timestamp");
  const rawBody = await c.req.text();

  if (
    !signature ||
    !timestamp ||
    !(await verifyDiscordSignature(c.env.DISCORD_PUBLIC_KEY, signature, timestamp, rawBody))
  ) {
    return c.text("invalid request signature", 401);
  }

  const interaction = JSON.parse(rawBody) as APIInteraction;

  if (interaction.type === InteractionType.Ping) {
    return pong();
  }

  if (
    interaction.type === InteractionType.ApplicationCommand &&
    interaction.data.type === ApplicationCommandType.ChatInput
  ) {
    const command = interaction as APIChatInputApplicationCommandInteraction;

    // Slash commands are guild-only (dm_permission: false at registration).
    if (!command.guild_id || !command.member) {
      return ephemeral("Cette commande ne fonctionne que dans un serveur.");
    }

    // Governance rows have a guild foreign key, so ensure the tenant first.
    await ensureGuild(c.env, command.guild_id);
    c.executionCtx.waitUntil(emitWorkerAutomationEvent(c.env,command.guild_id,{
      event:{type:"slash_command_executed",id:interaction.id,depth:0},guild:{id:command.guild_id},
      user:{id:command.member.user.id,name:command.member.user.username,bot:command.member.user.bot??false,roleIds:command.member.roles},
      channel:command.channel_id?{id:command.channel_id}:undefined,command:command.data.name,
    }));

    const handler = builtins[command.data.name];
    if (handler) {
      // Existing temporary channels remain manageable after creation is disabled.
      const disabled = await moduleDisabled(c.env, command.guild_id, command.data.name === "voice" ? null : moduleForCommand(command.data.name));
      if (disabled) return disabled;
      const moduleId = command.data.name === "voice" ? "temp_voice" : moduleForCommand(command.data.name);
      return trackFeatureResult(c, command.guild_id, moduleId, handler({
        env: c.env,
        interaction: command,
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      }));
    }

    const customDisabled = await moduleDisabled(c.env, command.guild_id, "custom_commands");
    if (customDisabled) return customDisabled;
    const custom = await getEnabledSlashCommand(c.env.DB, command.guild_id, command.data.name);
    if (custom) {
      return trackFeatureResult(c, command.guild_id, "custom_commands", executeCustomCommand(c.env, command, custom, (p) => c.executionCtx.waitUntil(p)));
    }

    return ephemeral(`Commande inconnue : \`/${command.data.name}\`.`);
  }

  if (interaction.type === InteractionType.MessageComponent) {
    if (!interaction.guild_id || !interaction.member) {
      return ephemeral("Ce bouton ne fonctionne que dans un serveur.");
    }
    await ensureGuild(c.env, interaction.guild_id);
    const componentTrigger=interaction.data.component_type===ComponentType.Button?"button_pressed":interaction.data.component_type===ComponentType.StringSelect?"select_menu":null;
    if(componentTrigger)c.executionCtx.waitUntil(emitWorkerAutomationEvent(c.env,interaction.guild_id,{
      event:{type:componentTrigger,id:interaction.id,depth:0},guild:{id:interaction.guild_id},
      user:{id:interaction.member.user.id,name:interaction.member.user.username,bot:interaction.member.user.bot??false,roleIds:interaction.member.roles},
      channel:interaction.channel_id?{id:interaction.channel_id}:undefined,
      message:interaction.message?{id:interaction.message.id}:undefined,
      component:{customId:interaction.data.custom_id,values:"values"in interaction.data?[...interaction.data.values]:undefined},
    }));
    const disabled = await moduleDisabled(c.env, interaction.guild_id, moduleForComponent(interaction.data.custom_id));
    if (disabled) return disabled;
    const handler = findComponentHandler(interaction.data.custom_id);
    if (handler) {
      const moduleId = moduleForComponent(interaction.data.custom_id);
      return trackFeatureResult(c, interaction.guild_id, moduleId, handler({ env: c.env, interaction, waitUntil: (p) => c.executionCtx.waitUntil(p) }));
    }
    return ephemeral("Ce bouton n'est plus pris en charge.");
  }

  if (interaction.type === InteractionType.ModalSubmit) {
    if (!interaction.guild_id || !interaction.member) {
      return ephemeral("Ce formulaire ne fonctionne que dans un serveur.");
    }
    await ensureGuild(c.env, interaction.guild_id);
    const disabled = await moduleDisabled(c.env, interaction.guild_id, moduleForComponent(interaction.data.custom_id));
    if (disabled) return disabled;
    const handler = findModalHandler(interaction.data.custom_id);
    if (handler) {
      const moduleId = moduleForComponent(interaction.data.custom_id);
      return trackFeatureResult(c, interaction.guild_id, moduleId, handler({ env: c.env, interaction, waitUntil: (p) => c.executionCtx.waitUntil(p) }));
    }
    return ephemeral("Ce formulaire n'est plus pris en charge.");
  }

  return ephemeral("Type d'interaction non pris en charge.");
});
