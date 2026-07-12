import { type Client } from "discord.js";
import type { ConfigCache } from "./config-cache.js";
import type { WorkerApi } from "./worker-api.js";

/**
 * Voice XP (M22): once a minute, every member currently eligible in a voice
 * channel is posted to the Worker, which grants `voice_xp_per_min` each. The
 * gateway only decides eligibility; amounts, curve and rewards stay Worker-side
 * (mirrors the message-XP split in xp.ts).
 *
 * Eligibility (anti-AFK-farm): not a bot, not muted/deafened (self or server),
 * not in the AFK channel, and at least two humans sharing the channel.
 */
const TICK_MS = 60_000;
const BATCH = 100; // the /internal/voice-xp cap

export function registerVoiceXp(client: Client, cache: ConfigCache, api: WorkerApi): void {
  async function tick(): Promise<void> {
    for (const guild of client.guilds.cache.values()) {
      const cfg = await cache.get(guild.id).catch(() => null);
      if (!cfg?.xp.voiceEnabled) continue;

      const entries: Array<{ userId: string; username: string | null; channelId: string }> = [];
      for (const channel of guild.channels.cache.values()) {
        if (!channel.isVoiceBased() || channel.id === guild.afkChannelId) continue;
        const humans = channel.members.filter((m) => !m.user.bot);
        if (humans.size < 2) continue; // needs at least two people together
        for (const member of humans.values()) {
          if (member.voice.mute || member.voice.deaf) continue;
          entries.push({ userId: member.id, username: member.user.username, channelId: channel.id });
        }
      }
      if (entries.length === 0) continue;

      for (let i = 0; i < entries.length; i += BATCH) {
        api
          .postVoiceXp(guild.id, entries.slice(i, i + BATCH))
          .catch((err) => console.error(`voice xp ${guild.id} failed:`, err instanceof Error ? err.message : err));
      }
    }
  }

  setInterval(() => void tick(), TICK_MS).unref();
}
