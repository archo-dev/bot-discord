import {
  EmbedBuilder,
  Events,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
} from "discord.js";
import { substituteVariables } from "@bot/shared";
import type { ConfigCache } from "./config-cache.js";
import type { WorkerApi } from "./worker-api.js";

const COLORS = { green: 0x57f287, red: 0xed4245, yellow: 0xfee75c, blurple: 0x5865f2 } as const;

function truncate(text: string, max = 1000): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Guild-scoped channel lookup: a channel id from another guild resolves to nothing. */
export async function sendTo(guild: Guild, channelId: string | null, payload: { content?: string; embeds?: EmbedBuilder[] }): Promise<void> {
  if (!channelId) return;
  try {
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (channel?.isTextBased()) await channel.send(payload);
  } catch (err) {
    console.error(`send to ${guild.id}/${channelId} failed:`, err instanceof Error ? err.message : err);
  }
}

export function registerEvents(client: Client, cache: ConfigCache, api: WorkerApi): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    const cfg = await cache.get(member.guild.id).catch(() => null);
    if (!cfg) return;

    for (const roleId of cfg.autoRoles) {
      try {
        await member.roles.add(roleId, "Rôle automatique à l'arrivée");
      } catch (err) {
        console.error(`auto-role ${roleId} on ${member.guild.id} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (cfg.welcome.welcomeEnabled && cfg.welcome.welcomeChannelId) {
      await sendTo(member.guild, cfg.welcome.welcomeChannelId, {
        content: substituteVariables(cfg.welcome.welcomeMessage, {
          userName: member.user.username,
          userId: member.id,
          serverName: member.guild.name,
          memberCount: member.guild.memberCount,
          channelId: cfg.welcome.welcomeChannelId,
        }),
      });
    }

    if (cfg.logs.memberJoin) {
      await sendTo(member.guild, cfg.logs.channelId, {
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.green)
            .setTitle("Membre arrivé")
            .setDescription(`${member} (\`${member.user.tag}\`)`)
            .addFields({ name: "Compte créé", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` })
            .setFooter({ text: `ID: ${member.id}` })
            .setTimestamp(),
        ],
      });
    }

    api.postEvent(member.guild.id, "member_join", { userId: member.id }).catch(() => {});
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const cfg = await cache.get(member.guild.id).catch(() => null);
    if (!cfg) return;

    if (cfg.welcome.leaveEnabled && cfg.welcome.leaveChannelId) {
      await sendTo(member.guild, cfg.welcome.leaveChannelId, {
        content: substituteVariables(cfg.welcome.leaveMessage, {
          userName: member.user?.username ?? "Un membre",
          userId: member.id,
          serverName: member.guild.name,
          memberCount: member.guild.memberCount,
          channelId: cfg.welcome.leaveChannelId,
        }),
      });
    }

    if (cfg.logs.memberLeave) {
      await sendTo(member.guild, cfg.logs.channelId, {
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.red)
            .setTitle("Membre parti")
            .setDescription(`\`${member.user?.tag ?? member.id}\``)
            .setFooter({ text: `ID: ${member.id}` })
            .setTimestamp(),
        ],
      });
    }

    api.postEvent(member.guild.id, "member_leave", { userId: member.id }).catch(() => {});
  });

  client.on(Events.MessageDelete, async (message: Message | PartialMessage) => {
    if (!message.guild || message.author?.bot) return;
    const cfg = await cache.get(message.guild.id).catch(() => null);
    if (!cfg?.logs.messageDelete) return;

    await sendTo(message.guild, cfg.logs.channelId, {
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.red)
          .setTitle("Message supprimé")
          .setDescription(message.content ? truncate(message.content) : "*(contenu non disponible)*")
          .addFields(
            { name: "Auteur", value: message.author ? `${message.author} (\`${message.author.tag}\`)` : "*(inconnu)*", inline: true },
            { name: "Salon", value: `<#${message.channelId}>`, inline: true },
          )
          .setTimestamp(),
      ],
    });
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot) return;
    // Embed unfurls retrigger the event without a content change — skip those.
    if (oldMessage.content === newMessage.content) return;
    const cfg = await cache.get(newMessage.guild.id).catch(() => null);
    if (!cfg?.logs.messageEdit) return;

    await sendTo(newMessage.guild, cfg.logs.channelId, {
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.yellow)
          .setTitle("Message modifié")
          .addFields(
            { name: "Avant", value: oldMessage.content ? truncate(oldMessage.content) : "*(contenu non disponible)*" },
            { name: "Après", value: newMessage.content ? truncate(newMessage.content) : "*(contenu non disponible)*" },
            { name: "Auteur", value: newMessage.author ? `${newMessage.author}` : "*(inconnu)*", inline: true },
            { name: "Salon", value: `<#${newMessage.channelId}> — [aller au message](${newMessage.url})`, inline: true },
          )
          .setTimestamp(),
      ],
    });
  });

  client.on(Events.GuildMemberUpdate, async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
    const cfg = await cache.get(newMember.guild.id).catch(() => null);
    if (!cfg?.logs.memberUpdate) return;

    const changes: Array<{ name: string; value: string }> = [];
    if (!oldMember.partial && oldMember.nickname !== newMember.nickname) {
      changes.push({
        name: "Surnom",
        value: `\`${oldMember.nickname ?? "(aucun)"}\` → \`${newMember.nickname ?? "(aucun)"}\``,
      });
    }
    if (!oldMember.partial) {
      const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
      const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
      if (added.size > 0) changes.push({ name: "Rôles ajoutés", value: added.map((r) => `${r}`).join(" ") });
      if (removed.size > 0) changes.push({ name: "Rôles retirés", value: removed.map((r) => `${r}`).join(" ") });
    }
    if (changes.length === 0) return;

    await sendTo(newMember.guild, cfg.logs.channelId, {
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blurple)
          .setTitle("Membre modifié")
          .setDescription(`${newMember} (\`${newMember.user.tag}\`)`)
          .addFields(changes)
          .setFooter({ text: `ID: ${newMember.id}` })
          .setTimestamp(),
      ],
    });
  });
}
