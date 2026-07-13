import { Hono } from "hono";
import {
  ApplicationCommandType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction,
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

export const interactionsRouter = new Hono<{ Bindings: Env }>();

async function moduleDisabled(env: Env, guildId: string, moduleId: ModuleId | null): Promise<Response | null> {
  if (!moduleId || await isGuildModuleEnabled(env.DB, guildId, moduleId)) return null;
  return ephemeral("Ce module est désactivé sur ce serveur.");
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

    const handler = builtins[command.data.name];
    if (handler) {
      // Existing temporary channels remain manageable after creation is disabled.
      const disabled = await moduleDisabled(c.env, command.guild_id, command.data.name === "voice" ? null : moduleForCommand(command.data.name));
      if (disabled) return disabled;
      return handler({
        env: c.env,
        interaction: command,
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      });
    }

    const customDisabled = await moduleDisabled(c.env, command.guild_id, "custom_commands");
    if (customDisabled) return customDisabled;
    const custom = await getEnabledSlashCommand(c.env.DB, command.guild_id, command.data.name);
    if (custom) {
      return executeCustomCommand(c.env, command, custom, (p) => c.executionCtx.waitUntil(p));
    }

    return ephemeral(`Commande inconnue : \`/${command.data.name}\`.`);
  }

  if (interaction.type === InteractionType.MessageComponent) {
    if (!interaction.guild_id || !interaction.member) {
      return ephemeral("Ce bouton ne fonctionne que dans un serveur.");
    }
    await ensureGuild(c.env, interaction.guild_id);
    const disabled = await moduleDisabled(c.env, interaction.guild_id, moduleForComponent(interaction.data.custom_id));
    if (disabled) return disabled;
    const handler = findComponentHandler(interaction.data.custom_id);
    if (handler) {
      return handler({ env: c.env, interaction, waitUntil: (p) => c.executionCtx.waitUntil(p) });
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
      return handler({ env: c.env, interaction, waitUntil: (p) => c.executionCtx.waitUntil(p) });
    }
    return ephemeral("Ce formulaire n'est plus pris en charge.");
  }

  return ephemeral("Type d'interaction non pris en charge.");
});
