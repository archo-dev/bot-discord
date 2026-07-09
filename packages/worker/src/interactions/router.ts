import { Hono } from "hono";
import {
  ApplicationCommandType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction,
} from "discord-api-types/v10";
import type { Env } from "../env.js";
import { verifyDiscordSignature } from "./verify.js";
import { builtins } from "./builtins/index.js";
import { ephemeral, pong } from "./respond.js";

export const interactionsRouter = new Hono<{ Bindings: Env }>();

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

    const handler = builtins[command.data.name];
    if (handler) {
      return handler({
        env: c.env,
        interaction: command,
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      });
    }

    // Custom command execution lands in M4.
    return ephemeral(`Commande inconnue : \`/${command.data.name}\`.`);
  }

  return ephemeral("Type d'interaction non pris en charge.");
});
