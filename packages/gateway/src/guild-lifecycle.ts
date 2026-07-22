import {
  ChannelType,
  Events,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import type { ConfigCache } from "./config-cache.js";
import type { WorkerApi } from "./worker-api.js";
import { errMsg } from "./util.js";

const WELCOME_COLOR = 0x5865f2;

type InstalledGuild = Pick<Guild, "id" | "name" | "icon">;

/**
 * READY hydrates discord.js' cache for guilds the bot had already joined, but
 * Discord does not emit GUILD_CREATE as a fresh installation for those guilds.
 * Reconcile the full cache on every start so a new/restarted Gateway restores
 * the Worker's `guilds.bot_installed` source of truth.
 */
export async function reconcileInstalledGuilds(
  guilds: Iterable<InstalledGuild>,
  api: Pick<WorkerApi, "postGuildInstalled">,
): Promise<{ synced: number; failed: number }> {
  const results = await Promise.all(
    [...guilds].map(async (guild) => {
      try {
        await api.postGuildInstalled(guild.id, { name: guild.name, icon: guild.icon });
        return true;
      } catch (err) {
        console.error(`guild cache reconciliation ${guild.id} failed:`, errMsg(err));
        return false;
      }
    }),
  );
  const synced = results.filter(Boolean).length;
  return { synced, failed: results.length - synced };
}

function canSend(channel: GuildBasedChannel, me: GuildMember): boolean {
  const perms = channel.permissionsFor(me);
  return (
    perms?.has(PermissionFlagsBits.ViewChannel) === true &&
    perms.has(PermissionFlagsBits.SendMessages) &&
    perms.has(PermissionFlagsBits.EmbedLinks)
  );
}

/**
 * First text channel the bot may post in (system channel preferred, then the
 * top-most text channel it can View + Send + Embed in). Null when none qualify.
 */
function pickWelcomeChannel(guild: Guild): TextChannel | null {
  const me = guild.members.me;
  if (!me) return null;

  const system = guild.systemChannel;
  if (system && canSend(system, me)) return system;

  const candidates = [...guild.channels.cache.values()]
    .filter((ch): ch is TextChannel => ch.type === ChannelType.GuildText && canSend(ch, me))
    .sort((a, b) => a.rawPosition - b.rawPosition);
  return candidates[0] ?? null;
}

async function sendWelcome(guild: Guild, panelUrl: string): Promise<void> {
  const channel = pickWelcomeChannel(guild);
  if (!channel) {
    console.log(`guildCreate ${guild.id}: aucun salon accessible pour le message de bienvenue`);
    return;
  }
  await channel.send({
    embeds: [
      {
        title: "👋 Merci de m'avoir ajouté !",
        color: WELCOME_COLOR,
        description: [
          "Je suis **Archodev** : modération, XP, musique, logs, salons vocaux temporaires…",
          "",
          "• Tapez `/` pour découvrir mes commandes.",
          "• `/tempvoice setup` configure les salons vocaux temporaires (« rejoindre pour créer »).",
          `• Panneau de configuration : ${panelUrl}`,
          "",
          "_Les commandes slash globales peuvent mettre jusqu'à 1 h à apparaître après l'ajout du bot._",
        ].join("\n"),
      },
    ],
  });
}

/**
 * Guild lifecycle (M25): keeps the D1 `guilds` row in sync when the bot is
 * added to / removed from a server, and greets new servers. Removes the
 * "panel empty until the first /ping" trap.
 */
export function registerGuildLifecycle(
  client: Client,
  configCache: ConfigCache,
  api: WorkerApi,
  panelUrl: string,
): void {
  client.once(Events.ClientReady, (readyClient) => {
    void reconcileInstalledGuilds(readyClient.guilds.cache.values(), api).then(({ synced, failed }) => {
      console.log(`guild cache reconciliation complete (${synced} synced, ${failed} failed)`);
    });
  });

  client.on(Events.GuildCreate, (guild) => {
    void (async () => {
      console.log(`guildCreate: ${guild.name} (${guild.id}) — ${guild.memberCount} membres`);
      try {
        await api.postGuildInstalled(guild.id, { name: guild.name, icon: guild.icon });
      } catch (err) {
        console.error(`guildCreate upsert ${guild.id} failed:`, errMsg(err));
      }
      try {
        await sendWelcome(guild, panelUrl);
      } catch (err) {
        console.error(`guildCreate welcome ${guild.id} failed:`, errMsg(err));
      }
    })();
  });

  client.on(Events.GuildDelete, (guild) => {
    // A GuildDelete during a Discord outage (guild unavailable) is NOT a removal.
    if (guild.available === false) {
      console.log(`guildDelete ${guild.id}: indisponible (panne Discord), ignoré`);
      return;
    }
    void (async () => {
      console.log(`guildDelete: ${guild.name ?? "?"} (${guild.id})`);
      configCache.invalidate(guild.id);
      try {
        await api.postGuildUninstalled(guild.id);
      } catch (err) {
        console.error(`guildDelete ${guild.id} failed:`, errMsg(err));
      }
    })();
  });
}
