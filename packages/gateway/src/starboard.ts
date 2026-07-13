import {
  Events,
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import type { ConfigCache } from "./config-cache.js";
import type { WorkerApi } from "./worker-api.js";
import { errMsg } from "./util.js";
import { isGatewayModuleEnabled } from "./module-config.js";

/** Matches the configured emoji: custom emoji by id, unicode by name. */
function emojiMatches(reaction: MessageReaction | PartialMessageReaction, configured: string): boolean {
  return reaction.emoji.id ? configured.includes(reaction.emoji.id) : reaction.emoji.name === configured;
}

/**
 * Starboard (M23): watches star reactions and reports the current effective
 * count to the Worker, which owns the threshold, the embed and its lifecycle.
 * The gateway only computes an abuse-resistant count (unique non-bot reactors,
 * author excluded) so self-stars and bot stars don't inflate it.
 */
export function registerStarboard(client: Client, cache: ConfigCache, api: WorkerApi): void {
  async function onReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    try {
      if (user.bot) return;
      const r = reaction.partial ? await reaction.fetch() : reaction;
      const message = r.message.partial ? await r.message.fetch() : r.message;
      if (!message.inGuild()) return;

      const cfg = await cache.get(message.guild.id).catch(() => null);
      if (!cfg?.starboard.enabled || !cfg.starboard.channelId || !isGatewayModuleEnabled(cfg, "starboard")) return;
      if (message.channelId === cfg.starboard.channelId) return; // ignore stars on the board itself
      if (!emojiMatches(r, cfg.starboard.emoji)) return;
      if (message.author?.bot) return; // don't starboard the bot's own / other bots' messages

      // Effective count: unique non-bot reactors, excluding the message author.
      const reactors = await r.users.fetch();
      const count = reactors.filter((u) => !u.bot && u.id !== message.author?.id).size;

      const image = message.attachments.find((a) => a.contentType?.startsWith("image/"));
      await api.postStarboard(message.guild.id, {
        messageId: message.id,
        channelId: message.channelId,
        authorTag: message.author ? (message.author.globalName ?? message.author.username) : "Inconnu",
        authorAvatarUrl: message.author?.displayAvatarURL({ size: 128 }) ?? null,
        content: message.content || null,
        imageUrl: image?.url ?? null,
        count,
      });
    } catch (err) {
      console.error("starboard reaction failed:", errMsg(err));
    }
  }

  client.on(Events.MessageReactionAdd, onReaction);
  client.on(Events.MessageReactionRemove, onReaction);
}
