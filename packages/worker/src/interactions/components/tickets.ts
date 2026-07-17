import type {
  APIInteractionGuildMember,
  APIMessage,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { ComponentType } from "discord-api-types/v10";
import {
  DEFAULT_TICKET_FORM,
  hasPermission,
  PermissionBits,
  ticketFormConfigSchema,
  type TicketFormConfig,
} from "@bot/shared";
import type { Env } from "../../env.js";
import { discordJson, discordUpload, DiscordAPIError } from "../../discord/rest.js";
import { deferred, editOriginal, ephemeral, modal } from "../respond.js";
import {
  cancelTicketReservation,
  claimTicket,
  closeTicket,
  compensateFailedTicketClose,
  finalizeTicketChannel,
  getOpenTicketForUser,
  getTicketByChannel,
  getTicketById,
  getTicketSettings,
  reserveTicket,
  setTicketPriority,
  setTicketState,
  unassignTicket,
  type TicketRow,
  type TicketSettingsRow,
} from "../../db/queries.js";
import type { ComponentContext } from "./index.js";

// Channel-permission bits (decimal strings, as the overwrite API expects).
const MEMBER_ALLOW = "117760"; // VIEW + SEND + EMBED_LINKS + ATTACH_FILES + READ_HISTORY
const STAFF_ALLOW = "125952"; // MEMBER_ALLOW + MANAGE_MESSAGES
const BOT_ALLOW = "117776"; // MEMBER_ALLOW + MANAGE_CHANNELS
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

function parseForm(settings: TicketSettingsRow): TicketFormConfig {
  if (!settings.form_config) return DEFAULT_TICKET_FORM;
  try {
    const parsed = ticketFormConfigSchema.safeParse(JSON.parse(settings.form_config));
    return parsed.success ? parsed.data : DEFAULT_TICKET_FORM;
  } catch {
    return DEFAULT_TICKET_FORM;
  }
}

function canCloseTicket(ticket: TicketRow, member: APIInteractionGuildMember, staffRoleIds: string[]): boolean {
  if (member.user.id === ticket.user_id) return true;
  return canTriageTicket(member, staffRoleIds);
}

function canTriageTicket(member: APIInteractionGuildMember, staffRoleIds: string[]): boolean {
  if (hasPermission(member.permissions, PermissionBits.MANAGE_GUILD)) return true;
  return member.roles.some((roleId) => staffRoleIds.includes(roleId));
}

type TicketInteraction = APIMessageComponentInteraction | APIModalSubmitInteraction;

async function startTicketCreation(
  ctx: ComponentContext<TicketInteraction>,
  settings: TicketSettingsRow,
  categoryKey: string | null,
  formResponse: Record<string, string> | null,
): Promise<Response> {
  const { env, interaction } = ctx;
  const guildId = interaction.guild_id!;
  const member = interaction.member!;
  const userId = member.user.id;
  const existing = await getOpenTicketForUser(env.DB, guildId, userId);
  if (existing) return ephemeral(`Vous avez déjà un ticket ouvert : <#${existing.channel_id}>.`);

  const cooldownKey = `ticketcd:${guildId}:${userId}`;
  if (await env.KV.get(cooldownKey)) return ephemeral("Veuillez patienter un peu avant d'ouvrir un nouveau ticket.");

  ctx.waitUntil((async () => {
    let reserved: Awaited<ReturnType<typeof reserveTicket>> = null;
    let channelId: string | null = null;
    try {
      await env.KV.put(cooldownKey, "1", { expirationTtl: 60 });
      reserved = await reserveTicket(env.DB, { guildId, userId, categoryKey, formResponse });
      if (!reserved) {
        const active = await getOpenTicketForUser(env.DB, guildId, userId);
        await editOriginal(env, interaction, {
          content: active ? `Vous avez déjà un ticket ouvert : <#${active.channel_id}>.` : "Une ouverture de ticket est déjà en cours.",
        });
        return;
      }
      const staffRoleIds = parseStaffRoleIds(settings);
      const channel = await discordJson<{ id: string }>(env, "POST", `/guilds/${guildId}/channels`, {
        name: `ticket-${String(reserved.number).padStart(4, "0")}`,
        type: 0,
        parent_id: settings.category_id,
        topic: `Ticket #${reserved.number} — ouvert par ${member.user.username} (${userId})${categoryKey ? ` — ${categoryKey}` : ""}`,
        permission_overwrites: [
          { id: guildId, type: 0, deny: EVERYONE_DENY },
          { id: userId, type: 1, allow: MEMBER_ALLOW },
          { id: interaction.application_id, type: 1, allow: BOT_ALLOW },
          ...staffRoleIds.map((roleId) => ({ id: roleId, type: 0, allow: STAFF_ALLOW })),
        ],
      }, { auditLogReason: `Ticket #${reserved.number} ouvert par ${userId}` });
      channelId = channel.id;
      if (!(await finalizeTicketChannel(env.DB, guildId, reserved.id, reserved.placeholderChannelId, channel.id))) {
        throw new Error("ticket reservation could not be finalized");
      }

      const form = parseForm(settings);
      const categoryLabel = form.categories.find((category) => category.id === categoryKey)?.label;
      const answerFields = formResponse
        ? form.fields.flatMap((field) => formResponse[field.id]
          ? [{ name: field.label, value: formResponse[field.id]!.slice(0, 1024), inline: false }]
          : [])
        : [];
      await discordJson(env, "POST", `/channels/${channel.id}/messages`, {
        content: `<@${userId}>`,
        embeds: [{
          title: `🎫 Ticket #${reserved.number}`,
          description: "Merci d'avoir ouvert un ticket. Un membre de l'équipe vous répondra dès que possible.",
          color: 0x5865f2,
          fields: [
            ...(categoryLabel ? [{ name: "Catégorie", value: categoryLabel, inline: true }] : []),
            ...answerFields,
          ],
        }],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 1, label: "Prendre", custom_id: `ticket:claim:${reserved.id}` },
            { type: 2, style: 2, label: "En attente", custom_id: `ticket:state:${reserved.id}:pending` },
            { type: 2, style: 2, label: "Priorité", custom_id: `ticket:priority:${reserved.id}` },
            { type: 2, style: 4, label: "Fermer", custom_id: "ticket:close", emoji: { name: "🔒" } },
          ],
        }],
        allowed_mentions: { users: [userId] },
      });
      await editOriginal(env, interaction, { content: `🎫 Votre ticket est ouvert : <#${channel.id}>` });
    } catch (err) {
      console.error(`startTicketCreation(${guildId}, ${userId}) failed:`, err);
      if (channelId) {
        await discordJson(env, "DELETE", `/channels/${channelId}`, undefined, {
          auditLogReason: "Compensation d'une ouverture de ticket incomplète",
        }).catch((deleteError) => console.error(`ticket channel compensation ${channelId} failed:`, deleteError));
      }
      if (reserved) await cancelTicketReservation(env.DB, reserved.id, guildId, userId);
      const hint = err instanceof DiscordAPIError && err.status === 403
        ? " Il manque probablement la permission Gérer les salons dans la catégorie configurée."
        : "";
      await editOriginal(env, interaction, { content: `Impossible de créer le ticket.${hint}` });
    }
  })());

  return deferred({ ephemeral: true });
}

// Legacy ticket:open and versioned ticket:open:v2[:category].
export async function openTicket(ctx: ComponentContext<APIMessageComponentInteraction>): Promise<Response> {
  const { env, interaction } = ctx;
  const guildId = interaction.guild_id!;
  const settings = await getTicketSettings(env.DB, guildId);
  if (!settings || settings.enabled !== 1 || !settings.category_id) {
    return ephemeral("Le système de tickets n'est pas configuré sur ce serveur.");
  }
  if (!interaction.data.custom_id.startsWith("ticket:open:v2")) {
    return startTicketCreation(ctx, settings, null, null);
  }
  if (settings.form_enabled !== 1) return ephemeral("Ce panneau de tickets n'est plus actif. Demandez sa republication.");

  const form = parseForm(settings);
  const idFromButton = interaction.data.custom_id.split(":")[3];
  const idFromSelect = "values" in interaction.data ? interaction.data.values[0] : undefined;
  const categoryKey = idFromButton ?? idFromSelect;
  if (!categoryKey || !form.categories.some((category) => category.id === categoryKey)) {
    return ephemeral("Cette catégorie n'est plus disponible. Demandez la republication du panneau.");
  }
  if (form.fields.length === 0) return startTicketCreation(ctx, settings, categoryKey, null);
  return modal({
    custom_id: `ticket:create:v2:${categoryKey}`,
    title: "Ouvrir un ticket",
    components: form.fields.map((field) => ({
      type: 1,
      components: [{
        type: 4,
        custom_id: field.id,
        label: field.label,
        style: field.style === "paragraph" ? 2 : 1,
        required: field.required,
        min_length: field.required ? 1 : undefined,
        max_length: field.maxLength,
      }],
    })),
  });
}

export async function submitOpenTicket(ctx: ComponentContext<APIModalSubmitInteraction>): Promise<Response> {
  const { env, interaction } = ctx;
  const settings = await getTicketSettings(env.DB, interaction.guild_id!);
  if (!settings || settings.enabled !== 1 || settings.form_enabled !== 1 || !settings.category_id) {
    return ephemeral("Le système de tickets n'est plus configuré.");
  }
  const form = parseForm(settings);
  const categoryKey = interaction.data.custom_id.split(":")[3];
  if (!categoryKey || !form.categories.some((category) => category.id === categoryKey)) {
    return ephemeral("Cette catégorie n'est plus disponible.");
  }
  const submitted = new Map<string, string>();
  for (const row of interaction.data.components) {
    const fields = "components" in row ? row.components : "component" in row ? [row.component] : [];
    for (const component of fields) {
      if (component.type !== ComponentType.TextInput || typeof component.value !== "string") continue;
      if (submitted.has(component.custom_id)) return ephemeral("Formulaire invalide.");
      submitted.set(component.custom_id, component.value.trim());
    }
  }
  if ([...submitted.keys()].some((id) => !form.fields.some((field) => field.id === id))) return ephemeral("Formulaire invalide.");
  const response: Record<string, string> = {};
  for (const field of form.fields) {
    const value = submitted.get(field.id) ?? "";
    if (field.required && value.length === 0) return ephemeral(`Le champ « ${field.label} » est obligatoire.`);
    if (value.length > field.maxLength) return ephemeral(`Le champ « ${field.label} » est trop long.`);
    if (value) response[field.id] = value;
  }
  return startTicketCreation(ctx, settings, categoryKey, response);
}

async function triageContext(ctx: ComponentContext<APIMessageComponentInteraction>): Promise<
  { ok: false; error: Response } |
  { ok: true; ticket: TicketRow; settings: TicketSettingsRow | null; parts: string[] }
> {
  const { env, interaction } = ctx;
  const parts = interaction.data.custom_id.split(":");
  const ticketId = Number(parts[2]);
  const ticket = Number.isSafeInteger(ticketId) ? await getTicketById(env.DB, interaction.guild_id!, ticketId) : null;
  if (!ticket || ticket.status !== "open" || ticket.channel_id !== interaction.channel.id) return { ok: false, error: ephemeral("Ticket introuvable ou fermé.") };
  const settings = await getTicketSettings(env.DB, ticket.guild_id);
  if (!canTriageTicket(interaction.member!, parseStaffRoleIds(settings))) return { ok: false, error: ephemeral("Cette action est réservée à l'équipe support.") };
  return { ok: true, ticket, settings, parts };
}

export async function toggleTicketClaim(ctx: ComponentContext<APIMessageComponentInteraction>): Promise<Response> {
  const checked = await triageContext(ctx);
  if (!checked.ok) return checked.error;
  const actorId = ctx.interaction.member!.user.id;
  if (checked.ticket.assignee_id === actorId) {
    await unassignTicket(ctx.env.DB, checked.ticket.guild_id, checked.ticket.id, actorId);
    return ephemeral("Ticket remis dans la file non assignée.");
  }
  const result = await claimTicket(ctx.env.DB, checked.ticket.guild_id, checked.ticket.id, actorId);
  if (result.outcome === "conflict") return ephemeral(`Ce ticket est déjà assigné à <@${result.ticket!.assignee_id}>.`);
  if (result.outcome === "not_found") return ephemeral("Ce ticket vient d'être fermé.");
  return ephemeral("Ticket assigné à vous.");
}

export async function changeTicketState(ctx: ComponentContext<APIMessageComponentInteraction>): Promise<Response> {
  const checked = await triageContext(ctx);
  if (!checked.ok) return checked.error;
  const state = checked.parts[3] === "pending" ? "pending" : checked.parts[3] === "open" ? "open" : null;
  if (!state) return ephemeral("État invalide.");
  await setTicketState(ctx.env.DB, checked.ticket.guild_id, checked.ticket.id, ctx.interaction.member!.user.id, state);
  return ephemeral(state === "pending" ? "Ticket placé en attente." : "Ticket rouvert dans la file active.");
}

export async function toggleTicketPriority(ctx: ComponentContext<APIMessageComponentInteraction>): Promise<Response> {
  const checked = await triageContext(ctx);
  if (!checked.ok) return checked.error;
  const priority = checked.ticket.priority === "high" ? "normal" : "high";
  await setTicketPriority(ctx.env.DB, checked.ticket.guild_id, checked.ticket.id, ctx.interaction.member!.user.id, priority);
  return ephemeral(priority === "high" ? "Priorité haute activée." : "Priorité normale restaurée.");
}

export async function promptCloseTicket(ctx: ComponentContext<APIMessageComponentInteraction>): Promise<Response> {
  const { env, interaction } = ctx;
  const ticket = await getTicketByChannel(env.DB, interaction.guild_id!, interaction.channel.id);
  if (!ticket || ticket.status !== "open") return ephemeral("Ce salon n'est pas (ou plus) un ticket ouvert.");
  const settings = await getTicketSettings(env.DB, ticket.guild_id);
  if (!canCloseTicket(ticket, interaction.member!, parseStaffRoleIds(settings))) {
    return ephemeral("Seuls le créateur du ticket et l'équipe support peuvent le fermer.");
  }
  return modal({
    custom_id: `ticket:closec:${ticket.id}`,
    title: `Fermer le ticket #${ticket.number}`,
    components: [{ type: 1, components: [{
      type: 4,
      custom_id: "reason",
      label: "Raison de la fermeture (optionnel)",
      style: 2,
      required: false,
      max_length: 512,
    }] }],
  });
}

export async function submitCloseTicket(ctx: ComponentContext<APIModalSubmitInteraction>): Promise<Response> {
  const { env, interaction } = ctx;
  const guildId = interaction.guild_id!;
  const member = interaction.member!;
  const ticketId = Number(interaction.data.custom_id.split(":")[2]);
  const ticket = Number.isSafeInteger(ticketId) ? await getTicketById(env.DB, guildId, ticketId) : null;
  if (!ticket || ticket.status !== "open") return ephemeral("Ce ticket n'existe pas ou est déjà fermé.");
  const settings = await getTicketSettings(env.DB, guildId);
  if (!canCloseTicket(ticket, member, parseStaffRoleIds(settings))) {
    return ephemeral("Seuls le créateur du ticket et l'équipe support peuvent le fermer.");
  }
  let reason: string | null = null;
  for (const row of interaction.data.components) {
    const fields = "components" in row ? row.components : "component" in row ? [row.component] : [];
    for (const component of fields) {
      if (component.type === ComponentType.TextInput && component.custom_id === "reason" && typeof component.value === "string" && component.value.trim()) {
        reason = component.value.trim().slice(0, 512);
      }
    }
  }
  ctx.waitUntil((async () => {
    let closedInDb = false;
    let channelDeleted = false;
    try {
      const transcript = await buildTranscript(env, ticket.channel_id);
      const closed = await closeTicket(env.DB, guildId, ticket.id, member.user.id, reason, transcript);
      if (!closed) {
        await editOriginal(env, interaction, { content: "Ce ticket vient déjà d'être fermé." });
        return;
      }
      closedInDb = true;
      await editOriginal(env, interaction, { content: "Ticket fermé. Suppression du salon…" });
      await discordJson(env, "DELETE", `/channels/${ticket.channel_id}`, undefined, {
        auditLogReason: `Ticket #${ticket.number} fermé par ${member.user.id}`,
      });
      channelDeleted = true;
      if (settings?.transcript_channel_id) {
        try {
          await discordUpload(env, `/channels/${settings.transcript_channel_id}/messages`, {
            embeds: [{
              title: `🔒 Ticket #${ticket.number} fermé`,
              color: 0xed4245,
              fields: [
                { name: "Ouvert par", value: `<@${ticket.user_id}>`, inline: true },
                { name: "Fermé par", value: `<@${member.user.id}>`, inline: true },
                ...(reason ? [{ name: "Raison", value: reason }] : []),
              ],
              timestamp: new Date().toISOString(),
            }],
            allowed_mentions: { parse: [] },
          }, { name: `ticket-${String(ticket.number).padStart(4, "0")}.txt`, content: transcript });
        } catch (err) {
          console.error(`transcript upload for ticket ${ticket.id} failed:`, err);
        }
      }
    } catch (err) {
      console.error(`submitCloseTicket(${ticket.id}) failed:`, err);
      if (closedInDb && !channelDeleted) {
        await compensateFailedTicketClose(env.DB, ticket).catch((rollbackError) => {
          console.error(`ticket close compensation ${ticket.id} failed:`, rollbackError);
        });
      }
      await editOriginal(env, interaction, { content: "Impossible de fermer le ticket. Réessayez ou contactez un admin." });
    }
  })());
  return deferred({ ephemeral: true });
}

/** Dumps up to ~500 messages of the channel, oldest first, as plain text. */
async function buildTranscript(env: Env, channelId: string): Promise<string> {
  const all: APIMessage[] = [];
  let before: string | undefined;
  for (let i = 0; i < 5; i++) {
    const batch = await discordJson<APIMessage[]>(env, "GET", `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`);
    all.push(...batch);
    if (batch.length < 100) break;
    before = batch[batch.length - 1]!.id;
  }
  all.reverse();
  const lines = all.map((message) => {
    const when = message.timestamp.slice(0, 16).replace("T", " ");
    let line = `[${when}] ${message.author.username}${message.author.bot ? " [bot]" : ""}: ${message.content ?? ""}`;
    for (const attachment of message.attachments ?? []) line += `\n    [pièce jointe] ${attachment.url}`;
    if (message.embeds?.length) line += `\n    [${message.embeds.length} embed(s)]`;
    return line;
  });
  return lines.join("\n") || "(aucun message)";
}
