import {
  InteractionResponseType,
  MessageFlags,
  Routes,
  type APIEmbed,
  type APIInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import type { Env } from "../env.js";

const DISCORD_API = "https://discord.com/api/v10";

const json = (payload: APIInteractionResponse): Response =>
  new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });

export function pong(): Response {
  return json({ type: InteractionResponseType.Pong });
}

/** Immediate CHANNEL_MESSAGE_WITH_SOURCE (type 4) response. */
export function message(
  content: string,
  opts: { ephemeral?: boolean; embeds?: APIEmbed[] } = {},
): Response {
  return json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content,
      embeds: opts.embeds,
      flags: opts.ephemeral ? MessageFlags.Ephemeral : undefined,
      allowed_mentions: { parse: [] },
    },
  });
}

export function embedMessage(embed: APIEmbed, opts: { ephemeral?: boolean } = {}): Response {
  return json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      embeds: [embed],
      flags: opts.ephemeral ? MessageFlags.Ephemeral : undefined,
      allowed_mentions: { parse: [] },
    },
  });
}

export function ephemeral(content: string): Response {
  return message(content, { ephemeral: true });
}

/** DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (type 5) — buys time past the 3s deadline. */
export function deferred(opts: { ephemeral?: boolean } = {}): Response {
  return json({
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: opts.ephemeral ? MessageFlags.Ephemeral : undefined },
  });
}

/** Edit the original (deferred) response via the interaction webhook. */
export async function editOriginal(
  env: Env,
  interaction: Pick<APIInteraction, "application_id" | "token">,
  payload: { content?: string; embeds?: APIEmbed[] },
): Promise<void> {
  const res = await fetch(
    `${DISCORD_API}${Routes.webhookMessage(interaction.application_id, interaction.token, "@original")}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
    },
  );
  if (!res.ok) {
    console.error(`editOriginal failed: ${res.status} ${await res.text()}`);
  }
}
