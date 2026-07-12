import {
  ChannelType,
  Events,
  type Client,
  type DMChannel,
  type Guild,
  type GuildMember,
  type NonThreadGuildBasedChannel,
  type VoiceBasedChannel,
  type VoiceState,
} from "discord.js";
import type { ConfigCache } from "./config-cache.js";
import type { GuildGatewayConfig, WorkerApi } from "./worker-api.js";
import { errMsg } from "./util.js";

const CREATE_COOLDOWN_MS = 10_000; // one creation per user per 10 s
const DELETE_DELAY_MS = 5_000; // grace period before deleting an emptied channel

type TempVoiceCfg = GuildGatewayConfig["tempVoice"];

interface RegistryEntry {
  guildId: string;
  ownerId: string;
}

/**
 * Temp voice (M26): "join to create". A lobby voice channel spawns a personal
 * temp channel on join; the member is moved in; the channel is deleted when it
 * empties. The Worker owns the durable registry (D1) — this module keeps a
 * mirror in memory and reconciles it against Discord at startup.
 */
export function registerTempVoice(client: Client, cache: ConfigCache, api: WorkerApi): void {
  const registry = new Map<string, RegistryEntry>(); // channelId -> entry
  const creating = new Set<string>(); // userIds with a creation in flight
  const cooldown = new Map<string, number>(); // userId -> next-allowed timestamp
  const pendingDeletion = new Map<string, NodeJS.Timeout>(); // channelId -> delete timer

  function cancelDeletion(channelId: string): void {
    const t = pendingDeletion.get(channelId);
    if (t) {
      clearTimeout(t);
      pendingDeletion.delete(channelId);
    }
  }

  function nonBotCount(channel: VoiceBasedChannel): number {
    return channel.members.filter((m) => !m.user.bot).size;
  }

  function renderName(template: string, member: GuildMember): string {
    const name = template
      .replace(/\{user\}/g, member.displayName || member.user.username)
      .replace(/\s+/g, " ")
      .trim();
    return name.slice(0, 100) || "Salon temporaire";
  }

  async function deleteTempChannel(guild: Guild, channelId: string): Promise<void> {
    pendingDeletion.delete(channelId);
    if (!registry.has(channelId)) return;
    const channel = guild.channels.cache.get(channelId);
    if (channel?.isVoiceBased() && nonBotCount(channel) > 0) return; // someone rejoined
    try {
      if (channel) await channel.delete("Salon vocal temporaire vide");
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 10003) console.error(`tempvoice delete ${channelId} failed:`, errMsg(err)); // 10003 = Unknown Channel
    }
    registry.delete(channelId);
    await api.unregisterTempVoiceChannel(guild.id, channelId).catch((e) => console.error("tempvoice unregister:", errMsg(e)));
  }

  function scheduleDeletion(guild: Guild, channelId: string): void {
    if (pendingDeletion.has(channelId)) return;
    const t = setTimeout(() => void deleteTempChannel(guild, channelId), DELETE_DELAY_MS);
    t.unref?.();
    pendingDeletion.set(channelId, t);
  }

  async function createTempChannel(guild: Guild, member: GuildMember, tv: TempVoiceCfg): Promise<void> {
    const userId = member.id;
    const now = Date.now();
    if ((cooldown.get(userId) ?? 0) > now || creating.has(userId)) return;
    creating.add(userId);
    try {
      const count = await api.countTempVoiceChannels(guild.id);
      if (count >= tv.maxChannels) {
        console.log(`tempvoice ${guild.id}: plafond atteint (${count}/${tv.maxChannels})`);
        return;
      }
      const lobby = tv.lobbyChannelId ? guild.channels.cache.get(tv.lobbyChannelId) : null;
      const parentId = tv.categoryId ?? lobby?.parentId ?? null;
      const channel = await guild.channels.create({
        name: renderName(tv.nameTemplate, member),
        type: ChannelType.GuildVoice,
        parent: parentId ?? undefined,
        userLimit: tv.userLimit || undefined,
      });
      // The member may have left the lobby before the channel was ready.
      if (member.voice.channelId !== tv.lobbyChannelId) {
        await channel.delete().catch(() => {});
        return;
      }
      try {
        await member.voice.setChannel(channel);
      } catch (err) {
        await channel.delete().catch(() => {});
        throw err;
      }
      try {
        await api.registerTempVoiceChannel(guild.id, { channelId: channel.id, ownerId: userId });
      } catch (err) {
        await channel.delete().catch(() => {}); // DB write failed → no orphan channel
        throw err;
      }
      registry.set(channel.id, { guildId: guild.id, ownerId: userId });
      cooldown.set(userId, now + CREATE_COOLDOWN_MS);
    } catch (err) {
      console.error(`tempvoice create ${guild.id} failed:`, errMsg(err));
    } finally {
      creating.delete(userId);
    }
  }

  async function handleVoiceUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guild = newState.guild;
    // Joined (or moved into) a channel.
    if (newState.channelId && newState.channelId !== oldState.channelId) {
      cancelDeletion(newState.channelId); // a (re)join cancels a pending deletion
      const member = newState.member;
      if (member && !member.user.bot) {
        const cfg = await cache.get(guild.id).catch(() => null);
        if (cfg?.tempVoice.enabled && newState.channelId === cfg.tempVoice.lobbyChannelId) {
          await createTempChannel(guild, member, cfg.tempVoice);
        }
      }
    }
    // Left (or moved out of) a channel.
    if (oldState.channelId && oldState.channelId !== newState.channelId && registry.has(oldState.channelId)) {
      const channel = oldState.guild.channels.cache.get(oldState.channelId);
      const remaining = channel?.isVoiceBased() ? nonBotCount(channel) : 0;
      if (remaining === 0) scheduleDeletion(oldState.guild, oldState.channelId);
    }
  }

  async function handleChannelDelete(channel: DMChannel | NonThreadGuildBasedChannel): Promise<void> {
    // A registered temp channel deleted manually → purge its row.
    const entry = registry.get(channel.id);
    if (entry) {
      registry.delete(channel.id);
      cancelDeletion(channel.id);
      await api
        .unregisterTempVoiceChannel(entry.guildId, channel.id)
        .catch((e) => console.error("tempvoice unregister:", errMsg(e)));
      return;
    }
    // The lobby deleted manually → disable + clear the config.
    if (!("guild" in channel) || !channel.guild) return;
    const cfg = await cache.get(channel.guild.id).catch(() => null);
    if (cfg?.tempVoice.enabled && cfg.tempVoice.lobbyChannelId === channel.id) {
      console.log(`tempvoice ${channel.guild.id}: salon déclencheur supprimé, désactivation`);
      cache.invalidate(channel.guild.id);
      await api
        .postTempVoiceLobbyDeleted(channel.guild.id)
        .catch((e) => console.error("tempvoice lobby-deleted:", errMsg(e)));
    }
  }

  async function reconcile(): Promise<void> {
    try {
      const channels = await api.listAllTempVoiceChannels();
      for (const { channelId, guildId, ownerId } of channels) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
          registry.set(channelId, { guildId, ownerId }); // guild unavailable; keep the row
          continue;
        }
        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
          await api.unregisterTempVoiceChannel(guildId, channelId).catch(() => {}); // orphan row
          continue;
        }
        registry.set(channelId, { guildId, ownerId });
        if (channel.isVoiceBased() && nonBotCount(channel) === 0) scheduleDeletion(guild, channelId);
      }
      console.log(`tempvoice: ${channels.length} salon(s) rechargé(s)`);
    } catch (err) {
      console.error("tempvoice reconcile failed:", errMsg(err));
    }
  }

  client.on(Events.VoiceStateUpdate, (oldState, newState) => void handleVoiceUpdate(oldState, newState));
  client.on(Events.ChannelDelete, (channel) => void handleChannelDelete(channel));
  client.on(Events.GuildDelete, (guild) => {
    for (const [channelId, entry] of registry) {
      if (entry.guildId === guild.id) {
        cancelDeletion(channelId);
        registry.delete(channelId);
      }
    }
  });
  client.once(Events.ClientReady, () => void reconcile());
}
