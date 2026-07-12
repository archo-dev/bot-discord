import { message } from "../respond.js";
import type { BuiltinHandler } from "./index.js";
import { userOption } from "./util.js";
import { SOCIAL_ACTIONS, pickGif, type SocialAction } from "./social-data.js";

function render(template: string, authorId: string, targetId: string): string {
  return template.replaceAll("{author}", `<@${authorId}>`).replaceAll("{target}", `<@${targetId}>`);
}

function makeHandler(action: SocialAction): BuiltinHandler {
  return async (ctx) => {
    const author = ctx.interaction.member!.user;
    const target = userOption(ctx.interaction, "membre");
    if (!target) return message("⚠️ Vous devez mentionner un membre valide.", { ephemeral: true });

    const isSelf = target.id === author.id;

    // Self-targeting refusal (playful, ephemeral) unless the action allows it.
    if (isSelf && !action.allowSelf) {
      return message(`${action.emoji} ${render(action.selfMessage, author.id, target.id)}`, { ephemeral: true });
    }

    const text = isSelf
      ? render(action.selfMessage, author.id, target.id)
      : target.bot && action.botMessage
        ? render(action.botMessage, author.id, target.id)
        : render(action.template, author.id, target.id);

    const gif = pickGif(action.gifs);
    const embeds = gif ? [{ color: action.color, image: { url: gif } }] : undefined;

    return message(`${action.emoji} ${text}`, {
      embeds,
      // Ping the target only (never self-ping, never mass-ping).
      allowedMentionUsers: isSelf ? [] : [target.id],
    });
  };
}

/** Built-in handlers for every social action, keyed by command name. */
export const socialHandlers: Record<string, BuiltinHandler> = Object.fromEntries(
  Object.entries(SOCIAL_ACTIONS).map(([name, action]) => [name, makeHandler(action)]),
);
