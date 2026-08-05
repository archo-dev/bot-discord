import { type Client, type GuildMember } from "discord.js";
import type { ConfigCache } from "./config-cache.js";
import type { WorkerApi } from "./worker-api.js";
import { errMsg } from "./util.js";
import { isGatewayModuleEnabled } from "./module-config.js";
import { observe } from "./observability.js";
import { eligibleVoiceXpEarners, type VoiceMemberState } from "./voice-xp-eligibility.js";

/**
 * Voice XP (M22): once a minute, every member currently *eligible* in a voice
 * channel is posted to the Worker, which grants `voice_xp_per_min` each. The
 * gateway only decides eligibility; amounts, curve and rewards stay Worker-side
 * (mirrors the message-XP split in xp.ts).
 *
 * Eligibility (anti-farm) lives in voice-xp-eligibility.ts: not a bot, not
 * muted/deafened (self or server), not in the AFK channel, module enabled, and
 * at least TWO active humans sharing the channel — a muted/deafened human does
 * not count as a conversation partner, so a lone active user earns nothing.
 *
 * The decision is stateless and re-evaluated at every tick from the live voice
 * state: an ineligible minute simply grants nothing (no retroactive XP, no ghost
 * session, no double count, correct resume once eligibility returns).
 */
const TICK_MS = 60_000;
const BATCH = 100; // the /internal/voice-xp cap

/** discord.js GuildMember → the plain state the eligibility rule reasons about. */
function toVoiceMemberState(member: GuildMember): VoiceMemberState {
  const v = member.voice;
  return {
    userId: member.id,
    isBot: member.user.bot,
    selfMute: Boolean(v.selfMute),
    selfDeaf: Boolean(v.selfDeaf),
    serverMute: Boolean(v.serverMute),
    serverDeaf: Boolean(v.serverDeaf),
  };
}

export function registerVoiceXp(client: Client, cache: ConfigCache, api: WorkerApi): void {
  async function tick(): Promise<void> {
    for (const guild of client.guilds.cache.values()) {
      const cfg = await cache.get(guild.id).catch(() => null);
      if (!cfg?.xp.voiceEnabled || !isGatewayModuleEnabled(cfg, "levels")) continue;

      const entries: Array<{ userId: string; username: string | null; channelId: string }> = [];
      let skippedSessions = 0;
      for (const channel of guild.channels.cache.values()) {
        if (!channel.isVoiceBased() || channel.id === guild.afkChannelId) continue;

        const members = [...channel.members.values()];
        const earnerIds = new Set(eligibleVoiceXpEarners(members.map(toVoiceMemberState)));
        // Everyone present but not earning is an ignored session (muted, deaf,
        // alone, bots-only). Bots never count as sessions.
        skippedSessions += members.filter((m) => !m.user.bot && !earnerIds.has(m.id)).length;

        for (const member of members) {
          if (!earnerIds.has(member.id)) continue;
          entries.push({ userId: member.id, username: member.user.username, channelId: channel.id });
        }
      }

      // Agrégat borné par guilde/tick — jamais d'ID utilisateur (anti-cardinalité).
      if (entries.length > 0 || skippedSessions > 0) {
        observe("info", "voice_xp_tick", { guildId: guild.id, eligibleSessions: entries.length, skippedSessions });
      }
      if (entries.length === 0) continue;

      for (let i = 0; i < entries.length; i += BATCH) {
        api
          .postVoiceXp(guild.id, entries.slice(i, i + BATCH))
          .catch((err) => console.error(`voice xp ${guild.id} failed:`, errMsg(err)));
      }
    }
  }

  setInterval(() => void tick(), TICK_MS).unref();
}
