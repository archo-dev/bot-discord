import { Events, type Client } from "discord.js";
import type { ChannelActivityEntry, WorkerApi } from "./worker-api.js";
import { errMsg } from "./util.js";

/*
 * Stats collection (M18). Everything is in-memory and flushed periodically —
 * no history scans, no per-event Worker round-trips. Counters lost on restart
 * (and voice sessions still open at shutdown) are accepted.
 */

const FLUSH_INTERVAL_MS = 60_000;
const SNAPSHOT_INTERVAL_MS = 3_600_000;

/** UTC 'YYYY-MM-DD'. */
function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}
/** UTC 'YYYY-MM-DDTHH:00' — the hourly bucket key. */
function hourBucket(): string {
  return `${new Date().toISOString().slice(0, 13)}:00`;
}

interface Bucket {
  messages: number;
  voiceSeconds: number;
}

export interface StatsController {
  /** Flushes buffered activity now (called on SIGTERM). */
  flush(): Promise<void>;
  /** Number of channel buckets waiting for the next bounded flush. */
  pendingEntries(): number;
}

export function registerStats(client: Client, api: WorkerApi): StatsController {
  // guildId → channelId → accumulated counts (current flush window).
  const buffer = new Map<string, Map<string, Bucket>>();
  const bump = (guildId: string, channelId: string, patch: Partial<Bucket>) => {
    let channels = buffer.get(guildId);
    if (!channels) {
      channels = new Map();
      buffer.set(guildId, channels);
    }
    const b = channels.get(channelId) ?? { messages: 0, voiceSeconds: 0 };
    b.messages += patch.messages ?? 0;
    b.voiceSeconds += patch.voiceSeconds ?? 0;
    channels.set(channelId, b);
  };

  // Message counts (humans only; bots excluded).
  client.on(Events.MessageCreate, (msg) => {
    if (!msg.guild || msg.author.bot) return;
    bump(msg.guild.id, msg.channelId, { messages: 1 });
  });

  // Voice session durations. Own VoiceStateUpdate listener, independent of the
  // voice-logging one (voice.ts). A channel change closes the running session.
  const sessions = new Map<string, { guildId: string; channelId: string; since: number }>();
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const oldCh = oldState.channelId;
    const newCh = newState.channelId;
    if (oldCh === newCh) return; // mute/deaf toggle: no session boundary
    const userId = newState.id;
    const s = sessions.get(userId);
    if (s && oldCh) {
      const secs = Math.round((Date.now() - s.since) / 1000);
      if (secs > 0) bump(s.guildId, s.channelId, { voiceSeconds: secs });
      sessions.delete(userId);
    }
    if (newCh) sessions.set(userId, { guildId: newState.guild.id, channelId: newCh, since: Date.now() });
  });

  async function flush(): Promise<void> {
    const windows = [...buffer.entries()];
    buffer.clear();
    const day = utcDay();
    for (const [guildId, channels] of windows) {
      const entries: ChannelActivityEntry[] = [...channels.entries()]
        .map(([channelId, b]) => ({ channelId, day, messageCount: b.messages, voiceSeconds: b.voiceSeconds }))
        .filter((e) => e.messageCount > 0 || e.voiceSeconds > 0);
      if (entries.length === 0) continue;
      try {
        await api.postChannelActivity(guildId, entries);
      } catch (err) {
        console.error(`channel-activity flush ${guildId} failed:`, errMsg(err));
      }
    }
  }
  setInterval(() => void flush(), FLUSH_INTERVAL_MS);

  // Hourly member snapshot (+ once at ready).
  async function snapshotMembers(): Promise<void> {
    const bucket = hourBucket();
    for (const guild of client.guilds.cache.values()) {
      let humans = 0;
      let bots = 0;
      try {
        const members = await guild.members.fetch();
        for (const m of members.values()) {
          if (m.user.bot) bots++;
          else humans++;
        }
      } catch {
        // Big guilds / rate limits: fall back to whatever is cached.
        for (const m of guild.members.cache.values()) {
          if (m.user.bot) bots++;
          else humans++;
        }
      }
      try {
        await api.postMemberSnapshot(guild.id, { bucket, total: guild.memberCount, humans, bots });
      } catch (err) {
        console.error(`member-snapshot ${guild.id} failed:`, errMsg(err));
      }
    }
  }
  client.once(Events.ClientReady, () => void snapshotMembers());
  setInterval(() => void snapshotMembers(), SNAPSHOT_INTERVAL_MS);

  return {
    flush,
    pendingEntries: () => {
      let count = 0;
      for (const channels of buffer.values()) count += channels.size;
      return count;
    },
  };
}
