import type { APIEmbed } from "discord-api-types/v10";
import { hasPermission, PermissionBits } from "@bot/shared";
import {
  activeWarningCount,
  getGuild,
  insertModAction,
  insertWarning,
  listWarnings,
} from "../../db/queries.js";
import { DiscordAPIError, discordJson, discordRequest } from "../../discord/rest.js";
import { deferred, editOriginal, ephemeral } from "../respond.js";
import type { BuiltinContext, BuiltinHandler } from "./index.js";
import { displayName, integerOption, modLogEmbed, postModLog, stringOption, userOption } from "./util.js";

interface ModResult {
  content: string;
  embeds?: APIEmbed[];
}

/**
 * Shared wrapper for moderation commands:
 * 1. verifies the invoking member's REAL permission bits (payload, not client),
 * 2. defers (all these commands chain REST + D1 and can exceed the 3s budget),
 * 3. runs the action in waitUntil and edits the deferred response.
 */
function moderation(
  required: bigint,
  opts: { ephemeral: boolean },
  run: (ctx: BuiltinContext) => Promise<ModResult>,
): BuiltinHandler {
  return async (ctx) => {
    if (!hasPermission(ctx.interaction.member!.permissions, required)) {
      return ephemeral("⛔ Vous n'avez pas la permission d'utiliser cette commande.");
    }
    ctx.waitUntil(
      (async () => {
        try {
          const result = await run(ctx);
          await editOriginal(ctx.env, ctx.interaction, { content: result.content, embeds: result.embeds });
        } catch (err) {
          console.error(`/${ctx.interaction.data.name} failed:`, err);
          const detail =
            err instanceof DiscordAPIError && err.status === 403
              ? "Le bot n'a pas les permissions nécessaires (vérifiez son rôle et la hiérarchie)."
              : "Une erreur est survenue.";
          await editOriginal(ctx.env, ctx.interaction, { content: `⚠️ ${detail}` });
        }
      })(),
    );
    return deferred({ ephemeral: opts.ephemeral });
  };
}

// ---------------------------------------------------------------------------

export const banHandler = moderation(PermissionBits.BAN_MEMBERS, { ephemeral: false }, async (ctx) => {
  const guildId = ctx.interaction.guild_id!;
  const moderatorId = ctx.interaction.member!.user.id;
  const target = userOption(ctx.interaction, "membre");
  const reason = stringOption(ctx.interaction, "raison") ?? null;
  if (!target) return { content: "⚠️ Membre introuvable." };
  if (target.id === moderatorId) return { content: "⚠️ Vous ne pouvez pas vous bannir vous-même." };

  await discordJson(ctx.env, "PUT", `/guilds/${guildId}/bans/${target.id}`, {}, { auditLogReason: reason ?? undefined });
  const caseId = await insertModAction(ctx.env.DB, { guildId, action: "ban", targetId: target.id, moderatorId, reason });
  await postModLog(ctx.env, guildId, modLogEmbed({ action: "ban", title: "🔨 Bannissement", targetId: target.id, moderatorId, reason, caseId }));
  return { content: `🔨 **${displayName(target)}** a été banni.${reason ? ` Raison : ${reason}` : ""}` };
});

export const unbanHandler = moderation(PermissionBits.BAN_MEMBERS, { ephemeral: false }, async (ctx) => {
  const guildId = ctx.interaction.guild_id!;
  const moderatorId = ctx.interaction.member!.user.id;
  const userId = stringOption(ctx.interaction, "user_id");
  const reason = stringOption(ctx.interaction, "raison") ?? null;
  if (!userId || !/^\d{5,20}$/.test(userId)) return { content: "⚠️ ID utilisateur invalide." };

  const res = await discordRequest(ctx.env, "DELETE", `/guilds/${guildId}/bans/${userId}`, undefined, {
    auditLogReason: reason ?? undefined,
  });
  if (res.status === 404) return { content: "⚠️ Cet utilisateur n'est pas banni." };
  if (!res.ok) throw new DiscordAPIError(res.status, await res.text(), "unban");

  const caseId = await insertModAction(ctx.env.DB, { guildId, action: "unban", targetId: userId, moderatorId, reason });
  await postModLog(ctx.env, guildId, modLogEmbed({ action: "unban", title: "✅ Débannissement", targetId: userId, moderatorId, reason, caseId }));
  return { content: `✅ L'utilisateur <@${userId}> a été débanni.` };
});

export const kickHandler = moderation(PermissionBits.KICK_MEMBERS, { ephemeral: false }, async (ctx) => {
  const guildId = ctx.interaction.guild_id!;
  const moderatorId = ctx.interaction.member!.user.id;
  const target = userOption(ctx.interaction, "membre");
  const reason = stringOption(ctx.interaction, "raison") ?? null;
  if (!target) return { content: "⚠️ Membre introuvable." };
  if (target.id === moderatorId) return { content: "⚠️ Vous ne pouvez pas vous expulser vous-même." };

  await discordJson(ctx.env, "DELETE", `/guilds/${guildId}/members/${target.id}`, undefined, {
    auditLogReason: reason ?? undefined,
  });
  const caseId = await insertModAction(ctx.env.DB, { guildId, action: "kick", targetId: target.id, moderatorId, reason });
  await postModLog(ctx.env, guildId, modLogEmbed({ action: "kick", title: "👢 Expulsion", targetId: target.id, moderatorId, reason, caseId }));
  return { content: `👢 **${displayName(target)}** a été expulsé.${reason ? ` Raison : ${reason}` : ""}` };
});

export const muteHandler = moderation(PermissionBits.MODERATE_MEMBERS, { ephemeral: false }, async (ctx) => {
  const guildId = ctx.interaction.guild_id!;
  const moderatorId = ctx.interaction.member!.user.id;
  const target = userOption(ctx.interaction, "membre");
  const minutes = integerOption(ctx.interaction, "duree");
  const reason = stringOption(ctx.interaction, "raison") ?? null;
  if (!target || !minutes) return { content: "⚠️ Paramètres invalides." };

  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await discordJson(
    ctx.env,
    "PATCH",
    `/guilds/${guildId}/members/${target.id}`,
    { communication_disabled_until: until },
    { auditLogReason: reason ?? undefined },
  );
  const caseId = await insertModAction(ctx.env.DB, {
    guildId,
    action: "timeout",
    targetId: target.id,
    moderatorId,
    reason,
    metadata: { durationMinutes: minutes },
  });
  await postModLog(
    ctx.env,
    guildId,
    modLogEmbed({
      action: "timeout",
      title: "🔇 Timeout",
      targetId: target.id,
      moderatorId,
      reason,
      caseId,
      extra: [{ name: "Durée", value: `${minutes} min` }],
    }),
  );
  return { content: `🔇 **${displayName(target)}** est mute pendant ${minutes} min.${reason ? ` Raison : ${reason}` : ""}` };
});

export const warnHandler = moderation(PermissionBits.MODERATE_MEMBERS, { ephemeral: false }, async (ctx) => {
  const guildId = ctx.interaction.guild_id!;
  const moderatorId = ctx.interaction.member!.user.id;
  const target = userOption(ctx.interaction, "membre");
  const reason = stringOption(ctx.interaction, "raison") ?? null;
  if (!target) return { content: "⚠️ Membre introuvable." };
  if (target.bot) return { content: "⚠️ Impossible d'avertir un bot." };

  await insertWarning(ctx.env.DB, guildId, target.id, moderatorId, reason);
  const caseId = await insertModAction(ctx.env.DB, { guildId, action: "warn", targetId: target.id, moderatorId, reason });
  await postModLog(ctx.env, guildId, modLogEmbed({ action: "warn", title: "⚠️ Avertissement", targetId: target.id, moderatorId, reason, caseId }));

  const count = await activeWarningCount(ctx.env.DB, guildId, target.id);
  const guild = await getGuild(ctx.env.DB, guildId);
  const threshold = guild?.warn_threshold ?? 3;
  const timeoutMinutes = guild?.warn_timeout_minutes ?? 60;

  let suffix = "";
  if (count >= threshold) {
    // Threshold reached → automatic timeout, attributed to 'system'.
    try {
      const until = new Date(Date.now() + timeoutMinutes * 60_000).toISOString();
      await discordJson(
        ctx.env,
        "PATCH",
        `/guilds/${guildId}/members/${target.id}`,
        { communication_disabled_until: until },
        { auditLogReason: `Seuil de ${threshold} avertissements atteint` },
      );
      const autoCaseId = await insertModAction(ctx.env.DB, {
        guildId,
        action: "auto_timeout",
        targetId: target.id,
        moderatorId: "system",
        reason: `Seuil de ${threshold} avertissements atteint`,
        metadata: { durationMinutes: timeoutMinutes, warnCount: count },
      });
      await postModLog(
        ctx.env,
        guildId,
        modLogEmbed({
          action: "auto_timeout",
          title: "🔇 Timeout automatique (seuil de warns)",
          targetId: target.id,
          moderatorId,
          reason: `${count} avertissements actifs (seuil : ${threshold})`,
          caseId: autoCaseId,
          extra: [{ name: "Durée", value: `${timeoutMinutes} min` }],
        }),
      );
      suffix = `\n🔇 Seuil de **${threshold}** warns atteint → mute automatique de ${timeoutMinutes} min.`;
    } catch (err) {
      console.error("auto-timeout failed:", err);
      suffix = `\n⚠️ Seuil de ${threshold} warns atteint mais le mute automatique a échoué (permissions du bot ?).`;
    }
  }

  return {
    content: `⚠️ **${displayName(target)}** a reçu un avertissement (${count}${count >= threshold ? "" : `/${threshold}`}).${reason ? ` Raison : ${reason}` : ""}${suffix}`,
  };
});

export const warningsHandler = moderation(PermissionBits.MODERATE_MEMBERS, { ephemeral: true }, async (ctx) => {
  const guildId = ctx.interaction.guild_id!;
  const target = userOption(ctx.interaction, "membre");
  if (!target) return { content: "⚠️ Membre introuvable." };

  const warnings = await listWarnings(ctx.env.DB, guildId, target.id);
  if (warnings.length === 0) return { content: `✅ **${displayName(target)}** n'a aucun avertissement.` };

  const active = warnings.filter((w) => w.revoked_at === null);
  return {
    content: "",
    embeds: [
      {
        title: `Avertissements de ${displayName(target)}`,
        color: 0xfee75c,
        description: warnings
          .slice(0, 15)
          .map(
            (w) =>
              `${w.revoked_at ? "~~" : ""}**#${w.id}** — ${w.reason ?? "(sans raison)"} · par <@${w.moderator_id}> · ${w.created_at} UTC${w.revoked_at ? "~~ (révoqué)" : ""}`,
          )
          .join("\n"),
        footer: { text: `${active.length} actif(s) / ${warnings.length} au total` },
      },
    ],
  };
});

export const clearHandler = moderation(PermissionBits.MANAGE_MESSAGES, { ephemeral: true }, async (ctx) => {
  const guildId = ctx.interaction.guild_id!;
  const moderatorId = ctx.interaction.member!.user.id;
  const channelId = ctx.interaction.channel.id;
  const amount = integerOption(ctx.interaction, "nombre");
  if (!amount || amount < 1 || amount > 100) return { content: "⚠️ Nombre invalide (1-100)." };

  const messages = await discordJson<Array<{ id: string }>>(ctx.env, "GET", `/channels/${channelId}/messages?limit=${amount}`);
  // Bulk delete refuses messages older than 14 days.
  const cutoff = BigInt(Date.now() - 14 * 24 * 3600_000 - 1420070400000) << 22n;
  const deletable = messages.filter((m) => BigInt(m.id) > cutoff).map((m) => m.id);

  if (deletable.length === 0) return { content: "⚠️ Aucun message supprimable (moins de 14 jours) trouvé." };
  if (deletable.length === 1) {
    await discordJson(ctx.env, "DELETE", `/channels/${channelId}/messages/${deletable[0]}`);
  } else {
    await discordJson(ctx.env, "POST", `/channels/${channelId}/messages/bulk-delete`, { messages: deletable });
  }

  const caseId = await insertModAction(ctx.env.DB, {
    guildId,
    action: "clear",
    targetId: null,
    moderatorId,
    reason: null,
    metadata: { deletedCount: deletable.length, channelId },
  });
  await postModLog(
    ctx.env,
    guildId,
    modLogEmbed({
      action: "clear",
      title: "🧹 Messages supprimés",
      moderatorId,
      reason: null,
      caseId,
      extra: [
        { name: "Salon", value: `<#${channelId}>` },
        { name: "Nombre", value: String(deletable.length) },
      ],
    }),
  );
  return { content: `🧹 ${deletable.length} message(s) supprimé(s).` };
});
