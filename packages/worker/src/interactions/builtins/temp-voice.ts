import {
  ApplicationCommandOptionType,
  type APIApplicationCommandInteractionDataBasicOption,
  type APIApplicationCommandInteractionDataSubcommandOption,
  type APIChatInputApplicationCommandInteraction,
  type APIUser,
} from "discord-api-types/v10";
import { hasPermission, PermissionBits } from "@bot/shared";
import {
  countTempVoiceChannels,
  disableTempVoice,
  getTempVoiceChannel,
  getTempVoiceSettings,
  purgeTempVoiceChannels,
  setTempVoiceOwner,
  setTempVoiceRenamedAt,
  upsertTempVoiceSettings,
} from "../../db/queries.js";
import { DiscordAPIError, discordJson, discordRequest } from "../../discord/rest.js";
import { deferred, editOriginal, embedMessage, ephemeral } from "../respond.js";
import type { BuiltinContext, BuiltinHandler } from "./index.js";

/** Expected, user-facing errors (clean message, no stack log). */
class UserError extends Error {}

const CONNECT = (1n << 20n).toString(); // Connect permission bit, as a string for overwrites.
const MOVE_MEMBERS = 1n << 24n;
const RENAME_COOLDOWN_MS = 5 * 60 * 1000; // Discord caps channel-name PATCH at 2/10 min.
const REQUIRED_PERMS_TEXT = "Voir le salon, Se connecter, Gérer les salons, Déplacer des membres";

type BasicOption = APIApplicationCommandInteractionDataBasicOption;

function getSubcommand(
  interaction: APIChatInputApplicationCommandInteraction,
): { name: string; options: BasicOption[] } | null {
  const sub = interaction.data.options?.find(
    (o): o is APIApplicationCommandInteractionDataSubcommandOption =>
      o.type === ApplicationCommandOptionType.Subcommand,
  );
  if (!sub) return null;
  return { name: sub.name, options: (sub.options ?? []) as BasicOption[] };
}

function optString(options: BasicOption[], name: string): string | undefined {
  const o = options.find((x) => x.name === name);
  return typeof o?.value === "string" ? o.value : undefined;
}
function optInt(options: BasicOption[], name: string): number | undefined {
  const o = options.find((x) => x.name === name);
  return typeof o?.value === "number" ? o.value : undefined;
}
/** Channel (type 7) and String options both carry a string value; names are unique. */
function optChannelId(options: BasicOption[], name: string): string | undefined {
  const o = options.find((x) => x.name === name);
  return typeof o?.value === "string" ? o.value : undefined;
}
function optUser(
  interaction: APIChatInputApplicationCommandInteraction,
  options: BasicOption[],
  name: string,
): APIUser | undefined {
  const o = options.find((x) => x.name === name);
  if (o?.type !== ApplicationCommandOptionType.User) return undefined;
  return interaction.data.resolved?.users?.[o.value];
}

function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 100);
  return cleaned.length > 0 ? cleaned : "Salon temporaire";
}

/** SQLite datetime('now') → epoch ms (stored as UTC "YYYY-MM-DD HH:MM:SS"). */
function parseSqliteUtc(s: string): number {
  return new Date(`${s.replace(" ", "T")}Z`).getTime();
}

/** The channel the member is currently connected to (null = not in voice). */
async function getMemberVoiceChannel(env: BuiltinContext["env"], guildId: string, userId: string): Promise<string | null> {
  try {
    const vs = await discordJson<{ channel_id: string | null }>(
      env,
      "GET",
      `/guilds/${guildId}/voice-states/${userId}`,
    );
    return vs.channel_id ?? null;
  } catch (err) {
    if (err instanceof DiscordAPIError && err.status === 404) return null; // no voice state
    throw err;
  }
}

// --- /tempvoice (admin) -----------------------------------------------------

async function tempvoiceSetup(ctx: BuiltinContext, options: BasicOption[]): Promise<string> {
  const guildId = ctx.interaction.guild_id!;
  const existingLobby = optChannelId(options, "salon");
  const category = optChannelId(options, "categorie") ?? null;
  const prev = await getTempVoiceSettings(ctx.env.DB, guildId);

  // Heuristic warning from the bot's permissions in the invoking channel.
  const appPerms = ctx.interaction.app_permissions ?? "0";
  const missing: string[] = [];
  if (!hasPermission(appPerms, PermissionBits.MANAGE_CHANNELS)) missing.push("Gérer les salons");
  if (!hasPermission(appPerms, MOVE_MEMBERS)) missing.push("Déplacer des membres");

  let lobbyId: string;
  let createdByBot = false;
  if (existingLobby) {
    lobbyId = existingLobby;
  } else {
    const created = await discordJson<{ id: string }>(ctx.env, "POST", `/guilds/${guildId}/channels`, {
      name: "➕ Créer un salon",
      type: 2,
      parent_id: category ?? undefined,
    });
    lobbyId = created.id;
    createdByBot = true;
  }

  await upsertTempVoiceSettings(ctx.env.DB, guildId, {
    enabled: true,
    lobbyChannelId: lobbyId,
    categoryId: category,
    lobbyCreatedByBot: createdByBot,
    nameTemplate: prev?.name_template ?? "🎧・{user}",
    userLimit: prev?.user_limit ?? 0,
    maxChannels: prev?.max_channels ?? 10,
  });

  let msg = `✅ Salons vocaux temporaires activés. Salon déclencheur : <#${lobbyId}>${createdByBot ? " (créé automatiquement)" : ""}.`;
  if (missing.length) {
    msg += `\n⚠️ Le bot semble manquer : ${missing.join(", ")}. Vérifiez ses permissions dans la catégorie.`;
  }
  return msg;
}

async function tempvoiceReset(ctx: BuiltinContext): Promise<string> {
  const guildId = ctx.interaction.guild_id!;
  const s = await getTempVoiceSettings(ctx.env.DB, guildId);
  if (s?.lobby_created_by_bot === 1 && s.lobby_channel_id) {
    try {
      await discordRequest(ctx.env, "DELETE", `/channels/${s.lobby_channel_id}`);
    } catch (err) {
      console.error("tempvoice reset: lobby delete failed:", err);
    }
  }
  await purgeTempVoiceChannels(ctx.env.DB, guildId);
  await disableTempVoice(ctx.env.DB, guildId, { clearLobby: true });
  return "🧹 Configuration réinitialisée. Les salons temporaires encore ouverts deviennent des salons ordinaires (ils ne seront plus supprimés automatiquement).";
}

async function tempvoiceStatus(ctx: BuiltinContext): Promise<Response> {
  const guildId = ctx.interaction.guild_id!;
  const s = await getTempVoiceSettings(ctx.env.DB, guildId);
  const active = await countTempVoiceChannels(ctx.env.DB, guildId);
  const lines = [
    `**État :** ${s?.enabled === 1 ? "✅ activé" : "⛔ désactivé"}`,
    `**Salon déclencheur :** ${s?.lobby_channel_id ? `<#${s.lobby_channel_id}>` : "—"}`,
    `**Catégorie :** ${s?.category_id ? `<#${s.category_id}>` : "(celle du lobby)"}`,
    `**Modèle de nom :** \`${s?.name_template ?? "🎧・{user}"}\``,
    `**Salons temporaires actifs :** ${active}${s ? ` / ${s.max_channels}` : ""}`,
  ];
  return embedMessage(
    {
      title: "🎧 Salons vocaux temporaires",
      color: 0x5865f2,
      description: lines.join("\n"),
      footer: { text: `Permissions requises pour le bot : ${REQUIRED_PERMS_TEXT}` },
    },
    { ephemeral: true },
  );
}

export const tempvoiceHandler: BuiltinHandler = async (ctx) => {
  if (!hasPermission(ctx.interaction.member!.permissions, PermissionBits.MANAGE_GUILD)) {
    return ephemeral("⛔ Vous avez besoin de la permission « Gérer le serveur » pour configurer les salons vocaux temporaires.");
  }
  const sub = getSubcommand(ctx.interaction);
  if (!sub) return ephemeral("Sous-commande inconnue.");

  if (sub.name === "status") return tempvoiceStatus(ctx);
  if (sub.name === "disable") {
    await disableTempVoice(ctx.env.DB, ctx.interaction.guild_id!, { clearLobby: false });
    return ephemeral("🔇 Les créations de salons temporaires sont désactivées. Les salons existants ne sont pas supprimés.");
  }

  // setup / reset touch the Discord REST API → defer.
  ctx.waitUntil(
    (async () => {
      try {
        const content = sub.name === "setup" ? await tempvoiceSetup(ctx, sub.options) : await tempvoiceReset(ctx);
        await editOriginal(ctx.env, ctx.interaction, { content });
      } catch (err) {
        if (!(err instanceof UserError)) console.error(`/tempvoice ${sub.name} failed:`, err);
        const detail =
          err instanceof UserError
            ? err.message
            : err instanceof DiscordAPIError && err.status === 403
              ? "Le bot n'a pas les permissions nécessaires (Gérer les salons)."
              : "Une erreur est survenue.";
        await editOriginal(ctx.env, ctx.interaction, { content: `⚠️ ${detail}` });
      }
    })(),
  );
  return deferred({ ephemeral: true });
};

// --- /voice (owner controls) ------------------------------------------------

async function runVoice(ctx: BuiltinContext, subName: string, options: BasicOption[]): Promise<string> {
  const guildId = ctx.interaction.guild_id!;
  const member = ctx.interaction.member!;
  const invokerId = member.user.id;

  const voiceChannelId = await getMemberVoiceChannel(ctx.env, guildId, invokerId);
  if (!voiceChannelId) {
    throw new UserError("Vous devez être connecté à votre salon vocal temporaire pour utiliser cette commande.");
  }
  const row = await getTempVoiceChannel(ctx.env.DB, voiceChannelId);
  if (!row || row.guild_id !== guildId) {
    throw new UserError("Ce salon n'est pas un salon vocal temporaire géré par le bot.");
  }

  const channelId = row.channel_id;
  const isOwner = row.owner_id === invokerId;
  const isManager = hasPermission(member.permissions, PermissionBits.MANAGE_CHANNELS);
  const requireControl = (): void => {
    if (!isOwner && !isManager) throw new UserError("Seul le propriétaire du salon peut faire cela.");
  };

  switch (subName) {
    case "rename": {
      requireControl();
      const name = sanitizeName(optString(options, "nom") ?? "");
      if (row.last_renamed_at && Date.now() - parseSqliteUtc(row.last_renamed_at) < RENAME_COOLDOWN_MS) {
        throw new UserError("Vous renommez trop souvent (limite Discord). Réessayez dans quelques minutes.");
      }
      await discordJson(ctx.env, "PATCH", `/channels/${channelId}`, { name });
      await setTempVoiceRenamedAt(ctx.env.DB, channelId);
      return `✅ Salon renommé en **${name}**.`;
    }
    case "limit": {
      requireControl();
      const n = optInt(options, "nombre") ?? 0;
      await discordJson(ctx.env, "PATCH", `/channels/${channelId}`, { user_limit: n });
      return n === 0 ? "✅ Limite d'utilisateurs retirée." : `✅ Limite fixée à **${n}** utilisateurs.`;
    }
    case "lock": {
      requireControl();
      await discordJson(ctx.env, "PUT", `/channels/${channelId}/permissions/${guildId}`, { type: 0, deny: CONNECT });
      return "🔒 Salon verrouillé : les autres membres ne peuvent plus rejoindre.";
    }
    case "unlock": {
      requireControl();
      await discordRequest(ctx.env, "DELETE", `/channels/${channelId}/permissions/${guildId}`);
      return "🔓 Salon déverrouillé.";
    }
    case "permit": {
      requireControl();
      const target = optUser(ctx.interaction, options, "utilisateur");
      if (!target) throw new UserError("Membre introuvable.");
      await discordJson(ctx.env, "PUT", `/channels/${channelId}/permissions/${target.id}`, { type: 1, allow: CONNECT });
      return `✅ <@${target.id}> peut désormais rejoindre le salon.`;
    }
    case "reject": {
      requireControl();
      const target = optUser(ctx.interaction, options, "utilisateur");
      if (!target) throw new UserError("Membre introuvable.");
      if (target.id === row.owner_id) throw new UserError("Vous ne pouvez pas refuser le propriétaire.");
      await discordJson(ctx.env, "PUT", `/channels/${channelId}/permissions/${target.id}`, { type: 1, deny: CONNECT });
      const targetVoice = await getMemberVoiceChannel(ctx.env, guildId, target.id).catch(() => null);
      if (targetVoice === channelId) {
        await discordRequest(ctx.env, "PATCH", `/guilds/${guildId}/members/${target.id}`, { channel_id: null }).catch(
          () => {},
        );
      }
      return `⛔ <@${target.id}> ne peut plus rejoindre le salon.`;
    }
    case "kick": {
      requireControl();
      const target = optUser(ctx.interaction, options, "utilisateur");
      if (!target) throw new UserError("Membre introuvable.");
      if (target.id === invokerId) throw new UserError("Vous ne pouvez pas vous expulser vous-même.");
      const targetVoice = await getMemberVoiceChannel(ctx.env, guildId, target.id).catch(() => null);
      if (targetVoice !== channelId) throw new UserError("Ce membre n'est pas dans votre salon.");
      await discordJson(ctx.env, "PATCH", `/guilds/${guildId}/members/${target.id}`, { channel_id: null });
      return `👋 <@${target.id}> a été expulsé du salon (pas du serveur).`;
    }
    case "transfer": {
      requireControl();
      const target = optUser(ctx.interaction, options, "utilisateur");
      if (!target) throw new UserError("Membre introuvable.");
      if (target.bot) throw new UserError("Vous ne pouvez pas transférer le salon à un bot.");
      if (target.id === row.owner_id) throw new UserError("Ce membre est déjà propriétaire.");
      const targetVoice = await getMemberVoiceChannel(ctx.env, guildId, target.id).catch(() => null);
      if (targetVoice !== channelId) throw new UserError("Le nouveau propriétaire doit être présent dans le salon.");
      await setTempVoiceOwner(ctx.env.DB, channelId, target.id);
      return `👑 <@${target.id}> est désormais propriétaire du salon.`;
    }
    case "claim": {
      if (isOwner) throw new UserError("Vous êtes déjà propriétaire de ce salon.");
      const ownerVoice = await getMemberVoiceChannel(ctx.env, guildId, row.owner_id).catch(() => null);
      if (ownerVoice === channelId) throw new UserError("Le propriétaire actuel est toujours présent dans le salon.");
      await setTempVoiceOwner(ctx.env.DB, channelId, invokerId);
      return "👑 Vous êtes désormais propriétaire de ce salon.";
    }
    default:
      throw new UserError("Sous-commande inconnue.");
  }
}

export const voiceHandler: BuiltinHandler = async (ctx) => {
  const sub = getSubcommand(ctx.interaction);
  if (!sub) return ephemeral("Sous-commande inconnue.");
  ctx.waitUntil(
    (async () => {
      try {
        const content = await runVoice(ctx, sub.name, sub.options);
        await editOriginal(ctx.env, ctx.interaction, { content });
      } catch (err) {
        if (!(err instanceof UserError)) console.error(`/voice ${sub.name} failed:`, err);
        const detail =
          err instanceof UserError
            ? err.message
            : err instanceof DiscordAPIError && err.status === 403
              ? "Le bot n'a pas les permissions nécessaires (Gérer les salons / Déplacer des membres)."
              : "Une erreur est survenue.";
        await editOriginal(ctx.env, ctx.interaction, { content: `⚠️ ${detail}` });
      }
    })(),
  );
  return deferred({ ephemeral: true });
};
