import type {
  APIInteractionGuildMember,
  APIMessage,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { ComponentType } from "discord-api-types/v10";
import { hasPermission, PermissionBits } from "@bot/shared";
import type { Env } from "../../env.js";
import { discordJson, discordUpload, DiscordAPIError } from "../../discord/rest.js";
import { deferred, editOriginal, ephemeral, modal } from "../respond.js";
import {
  allocateTicketNumber,
  closeTicket,
  getOpenTicketForUser,
  getTicketByChannel,
  getTicketById,
  getTicketSettings,
  insertTicket,
  type TicketRow,
  type TicketSettingsRow,
} from "../../db/queries.js";
import type { ComponentContext } from "./index.js";

// Channel-permission bits (decimal strings, as the overwrite API expects).
const MEMBER_ALLOW = "117760"; // VIEW + SEND + EMBED_LINKS + ATTACH_FILES + READ_HISTORY
const STAFF_ALLOW = "125952"; // MEMBER_ALLOW + MANAGE_MESSAGES
const BOT_ALLOW = "117776"; // MEMBER_ALLOW + MANAGE_CHANNELS (pour supprimer le salon)
const EVERYONE_DENY = "1024"; // VIEW_CHANNEL

function parseStaffRoleIds(settings: TicketSettingsRow | null): string[] {
  if (!settings) return [];
  try {
    const parsed = JSON.parse(settings.staff_role_ids) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function canCloseTicket(ticket: TicketRow, member: APIInteractionGuildMember, staffRoleIds: string[]): boolean {
  if (member.user.id === ticket.user_id) return true;
  if (hasPermission(member.permissions, PermissionBits.MANAGE_GUILD)) return true;
  return member.roles.some((r) => staffRoleIds.includes(r));
}

// --- ticket:open (bouton du panneau publié) ---------------------------------

export async function openTicket(ctx: ComponentContext<APIMessageComponentInteraction>): Promise<Response> {
  const { env, interaction } = ctx;
  const guildId = interaction.guild_id!;
  const member = interaction.member!;
  const userId = member.user.id;

  const settings = await getTicketSettings(env.DB, guildId);
  if (!settings || settings.enabled !== 1 || !settings.category_id) {
    return ephemeral("Le système de tickets n'est pas configuré sur ce serveur.");
  }

  const existing = await getOpenTicketForUser(env.DB, guildId, userId);
  if (existing) {
    return ephemeral(`Vous avez déjà un ticket ouvert : <#${existing.channel_id}>.`);
  }

  const cooldownKey = `ticketcd:${guildId}:${userId}`;
  if (await env.KV.get(cooldownKey)) {
    return ephemeral("Veuillez patienter un peu avant d'ouvrir un nouveau ticket.");
  }

  ctx.waitUntil(
    (async () => {
      try {
        await env.KV.put(cooldownKey, "1", { expirationTtl: 60 });
        const number = await allocateTicketNumber(env.DB, guildId);
        if (number === null) {
          await editOriginal(env, interaction, { content: "Configuration des tickets introuvable." });
          return;
        }
        const staffRoleIds = parseStaffRoleIds(settings);
        const channel = await discordJson<{ id: string }>(
          env,
          "POST",
          `/guilds/${guildId}/channels`,
          {
            name: `ticket-${String(number).padStart(4, "0")}`,
            type: 0,
            parent_id: settings.category_id,
            topic: `Ticket #${number} — ouvert par ${member.user.username} (${userId})`,
            permission_overwrites: [
              { id: guildId, type: 0, deny: EVERYONE_DENY },
              { id: userId, type: 1, allow: MEMBER_ALLOW },
              { id: interaction.application_id, type: 1, allow: BOT_ALLOW },
              ...staffRoleIds.map((roleId) => ({ id: roleId, type: 0, allow: STAFF_ALLOW })),
            ],
          },
          { auditLogReason: `Ticket #${number} ouvert par ${userId}` },
        );
        await insertTicket(env.DB, { guildId, number, channelId: channel.id, userId });
        await discordJson(env, "POST", `/channels/${channel.id}/messages`, {
          content: `<@${userId}>`,
          embeds: [
            {
              title: `🎫 Ticket #${number}`,
              description:
                "Merci d'avoir ouvert un ticket ! Décrivez votre demande, un membre du staff vous répondra dès que possible.",
              color: 0x5865f2,
            },
          ],
          components: [
            {
              type: 1,
              components: [
                { type: 2, style: 4, label: "Fermer le ticket", custom_id: "ticket:close", emoji: { name: "🔒" } },
              ],
            },
          ],
          allowed_mentions: { users: [userId] },
        });
        await editOriginal(env, interaction, { content: `🎫 Votre ticket est ouvert : <#${channel.id}>` });
      } catch (err) {
        console.error(`openTicket(${guildId}, ${userId}) failed:`, err);
        const hint =
          err instanceof DiscordAPIError && err.status === 403
            ? " Il manque probablement des permissions au bot (Gérer les salons) dans la catégorie configurée."
            : "";
        await editOriginal(env, interaction, { content: `Impossible de créer le ticket.${hint}` });
      }
    })(),
  );

  return deferred({ ephemeral: true });
}

// --- ticket:close (bouton dans le salon du ticket) --------------------------

export async function promptCloseTicket(ctx: ComponentContext<APIMessageComponentInteraction>): Promise<Response> {
  const { env, interaction } = ctx;
  const found = await getTicketByChannel(env.DB, interaction.channel.id);
  const ticket = found && found.guild_id === interaction.guild_id ? found : null;
  if (!ticket || ticket.status !== "open") {
    return ephemeral("Ce salon n'est pas (ou plus) un ticket ouvert.");
  }

  const settings = await getTicketSettings(env.DB, ticket.guild_id);
  if (!canCloseTicket(ticket, interaction.member!, parseStaffRoleIds(settings))) {
    return ephemeral("Seuls le créateur du ticket et le staff peuvent le fermer.");
  }

  return modal({
    custom_id: `ticket:closec:${ticket.id}`,
    title: `Fermer le ticket #${ticket.number}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "reason",
            label: "Raison de la fermeture (optionnel)",
            style: 2,
            required: false,
            max_length: 512,
          },
        ],
      },
    ],
  });
}

// --- ticket:closec:<id> (modal de confirmation) ------------------------------

export async function submitCloseTicket(ctx: ComponentContext<APIModalSubmitInteraction>): Promise<Response> {
  const { env, interaction } = ctx;
  const guildId = interaction.guild_id!;
  const member = interaction.member!;
  const ticketId = Number(interaction.data.custom_id.split(":")[2]);

  const ticket = Number.isInteger(ticketId) ? await getTicketById(env.DB, guildId, ticketId) : null;
  if (!ticket || ticket.status !== "open") {
    return ephemeral("Ce ticket n'existe pas ou est déjà fermé.");
  }

  // Defense in depth: the modal can only follow the button check, but re-verify.
  const settings = await getTicketSettings(env.DB, guildId);
  if (!canCloseTicket(ticket, member, parseStaffRoleIds(settings))) {
    return ephemeral("Seuls le créateur du ticket et le staff peuvent le fermer.");
  }

  let reason: string | null = null;
  for (const row of interaction.data.components) {
    const fields = "components" in row ? row.components : "component" in row ? [row.component] : [];
    for (const comp of fields) {
      if (
        comp.type === ComponentType.TextInput &&
        comp.custom_id === "reason" &&
        typeof comp.value === "string" &&
        comp.value.trim()
      ) {
        reason = comp.value.trim().slice(0, 512);
      }
    }
  }

  ctx.waitUntil(
    (async () => {
      try {
        const transcript = await buildTranscript(env, ticket.channel_id);
        const closed = await closeTicket(env.DB, ticket.id, member.user.id, reason, transcript);
        if (!closed) {
          await editOriginal(env, interaction, { content: "Ce ticket vient déjà d'être fermé." });
          return;
        }
        if (settings?.transcript_channel_id) {
          try {
            await discordUpload(
              env,
              `/channels/${settings.transcript_channel_id}/messages`,
              {
                embeds: [
                  {
                    title: `🔒 Ticket #${ticket.number} fermé`,
                    color: 0xed4245,
                    fields: [
                      { name: "Ouvert par", value: `<@${ticket.user_id}>`, inline: true },
                      { name: "Fermé par", value: `<@${member.user.id}>`, inline: true },
                      ...(reason ? [{ name: "Raison", value: reason }] : []),
                    ],
                    timestamp: new Date().toISOString(),
                  },
                ],
                allowed_mentions: { parse: [] },
              },
              { name: `ticket-${String(ticket.number).padStart(4, "0")}.txt`, content: transcript },
            );
          } catch (err) {
            // Le transcript reste en D1 : l'échec de l'envoi ne bloque pas la fermeture.
            console.error(`transcript upload for ticket ${ticket.id} failed:`, err);
          }
        }
        await editOriginal(env, interaction, { content: "Ticket fermé. Suppression du salon…" });
        await discordJson(env, "DELETE", `/channels/${ticket.channel_id}`, undefined, {
          auditLogReason: `Ticket #${ticket.number} fermé par ${member.user.id}`,
        });
      } catch (err) {
        console.error(`submitCloseTicket(${ticket.id}) failed:`, err);
        await editOriginal(env, interaction, {
          content: "Impossible de fermer le ticket (permissions du bot ?). Réessayez ou contactez un admin.",
        });
      }
    })(),
  );

  return deferred({ ephemeral: true });
}

/** Dumps up to ~500 messages of the channel, oldest first, as plain text. */
async function buildTranscript(env: Env, channelId: string): Promise<string> {
  const all: APIMessage[] = [];
  let before: string | undefined;
  for (let i = 0; i < 5; i++) {
    const batch = await discordJson<APIMessage[]>(
      env,
      "GET",
      `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`,
    );
    all.push(...batch);
    if (batch.length < 100) break;
    before = batch[batch.length - 1]!.id;
  }
  all.reverse();
  const lines = all.map((m) => {
    const when = m.timestamp.slice(0, 16).replace("T", " ");
    let line = `[${when}] ${m.author.username}${m.author.bot ? " [bot]" : ""}: ${m.content ?? ""}`;
    for (const a of m.attachments ?? []) line += `\n    [pièce jointe] ${a.url}`;
    if (m.embeds?.length) line += `\n    [${m.embeds.length} embed(s)]`;
    return line;
  });
  return lines.join("\n") || "(aucun message)";
}
