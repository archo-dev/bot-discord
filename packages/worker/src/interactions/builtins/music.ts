import { ApplicationCommandOptionType } from "discord-api-types/v10";
import type { MusicCommand, MusicCommandPayload } from "@bot/shared";
import { deletePlaylist, listPlaylists } from "../../db/queries.js";
import { forwardMusic } from "../../gateway/forward.js";
import { deferred, editOriginal, ephemeral, message } from "../respond.js";
import type { BuiltinContext, BuiltinHandler } from "./index.js";
import { integerOption, stringOption } from "./util.js";

function payloadBase(ctx: BuiltinContext, command: MusicCommand, arg: string | null): MusicCommandPayload {
  return {
    command,
    guildId: ctx.interaction.guild_id!,
    userId: ctx.interaction.member!.user.id,
    textChannelId: ctx.interaction.channel.id,
    applicationId: ctx.interaction.application_id,
    token: ctx.interaction.token,
    arg,
    source: "interaction",
  };
}

/**
 * Defers, then forwards to the gateway. On success the gateway edits the
 * interaction webhook itself; only an unreachable gateway is handled here.
 */
function forwarding(command: MusicCommand, getArg?: (ctx: BuiltinContext) => string | null): BuiltinHandler {
  return async (ctx) => {
    if (!ctx.interaction.guild_id) return ephemeral("⚠️ Commande utilisable uniquement sur un serveur.");
    const payload = payloadBase(ctx, command, getArg ? getArg(ctx) : null);
    ctx.waitUntil(
      (async () => {
        const result = await forwardMusic(ctx.env, payload);
        if (!result.reachable) {
          await editOriginal(ctx.env, ctx.interaction, {
            content: "⚠️ Le service musique est indisponible (gateway hors ligne).",
          });
        }
      })(),
    );
    return deferred({});
  };
}

export const playHandler = forwarding("play", (ctx) => stringOption(ctx.interaction, "recherche") ?? null);
export const pauseHandler = forwarding("pause");
export const resumeHandler = forwarding("resume");
export const skipHandler = forwarding("skip");
export const stopHandler = forwarding("stop");
export const queueHandler = forwarding("queue");
export const shuffleHandler = forwarding("shuffle");
export const nowplayingHandler = forwarding("nowplaying");
export const loopHandler = forwarding("loop", (ctx) => stringOption(ctx.interaction, "mode") ?? null);
export const volumeHandler = forwarding("volume", (ctx) => {
  const n = integerOption(ctx.interaction, "niveau");
  return n === undefined ? null : String(n);
});
export const seekHandler = forwarding("seek", (ctx) => {
  const n = integerOption(ctx.interaction, "secondes");
  return n === undefined ? null : String(n);
});
export const removeHandler = forwarding("remove", (ctx) => {
  const n = integerOption(ctx.interaction, "position");
  return n === undefined ? null : String(n);
});

/** /playlist save|load|list|delete — list/delete answer from D1 directly. */
export const playlistHandler: BuiltinHandler = async (ctx) => {
  const guildId = ctx.interaction.guild_id;
  if (!guildId) return ephemeral("⚠️ Commande utilisable uniquement sur un serveur.");

  const sub = ctx.interaction.data.options?.find((o) => o.type === ApplicationCommandOptionType.Subcommand);
  const subName = sub?.name;
  const nameOpt =
    sub && "options" in sub ? sub.options?.find((o) => o.name === "nom" && "value" in o) : undefined;
  const plName = nameOpt && "value" in nameOpt && typeof nameOpt.value === "string" ? nameOpt.value.trim() : null;

  if (subName === "list") {
    const rows = await listPlaylists(ctx.env.DB, guildId);
    if (rows.length === 0) return ephemeral("Aucune playlist enregistrée.");
    const lines = rows.map((r) => `• **${r.name}** — ${(JSON.parse(r.tracks) as unknown[]).length} piste(s)`);
    return message(lines.join("\n"), { ephemeral: true });
  }

  if (subName === "delete") {
    if (!plName) return ephemeral("⚠️ Précise le nom de la playlist.");
    const ok = await deletePlaylist(ctx.env.DB, guildId, plName);
    return ephemeral(ok ? `🗑️ Playlist **${plName}** supprimée.` : `⚠️ Playlist **${plName}** introuvable.`);
  }

  if (subName === "save" || subName === "load") {
    if (!plName) return ephemeral("⚠️ Précise le nom de la playlist.");
    const payload = payloadBase(ctx, subName === "save" ? "playlist_save" : "playlist_load", plName);
    ctx.waitUntil(
      (async () => {
        const result = await forwardMusic(ctx.env, payload);
        if (!result.reachable) {
          await editOriginal(ctx.env, ctx.interaction, {
            content: "⚠️ Le service musique est indisponible (gateway hors ligne).",
          });
        }
      })(),
    );
    return deferred({});
  }

  return ephemeral("⚠️ Sous-commande inconnue.");
};
