import type { MusicStateDto, MusicTrack, VoiceLogAction } from "@bot/shared";
import type { GatewayEnv } from "./env.js";
import { errMsg } from "./util.js";

/**
 * Typed client for the Worker's /internal/* API — the gateway's ONLY way to
 * read or write bot state (the Worker stays the single D1 writer).
 */

export interface GuildGatewayConfig {
  id: string;
  logChannelId: string | null;
  warnThreshold: number;
  warnTimeoutMinutes: number;
  /** Append a member card to welcome/leave messages that mention users (M20). */
  mentionCards: boolean;
  autoRoles: string[];
  welcome: {
    welcomeEnabled: boolean;
    welcomeChannelId: string | null;
    welcomeMessage: string;
    leaveEnabled: boolean;
    leaveChannelId: string | null;
    leaveMessage: string;
  };
  logs: {
    channelId: string | null;
    memberJoin: boolean;
    memberLeave: boolean;
    messageDelete: boolean;
    messageEdit: boolean;
    memberUpdate: boolean;
    voiceJoin: boolean;
    voiceLeave: boolean;
    voiceMove: boolean;
    voiceState: boolean;
  };
  automod: {
    antiSpamEnabled: boolean;
    antiSpamMaxMessages: number;
    antiSpamWindowSeconds: number;
    antiInviteEnabled: boolean;
    antiLinkEnabled: boolean;
    linkWhitelist: string[];
    bannedWords: string[];
    exemptRoleIds: string[];
    exemptChannelIds: string[];
    action: "delete" | "warn" | "timeout";
    timeoutMinutes: number;
  };
  xp: {
    enabled: boolean;
    cooldownSeconds: number;
    /** Voice XP (M22): award XP per minute spent in voice. */
    voiceEnabled: boolean;
  };
  starboard: {
    enabled: boolean;
    channelId: string | null;
    threshold: number;
    emoji: string;
  };
  /** Temp voice (M26): "join to create" lobby + auto channels. */
  tempVoice: {
    enabled: boolean;
    lobbyChannelId: string | null;
    categoryId: string | null;
    nameTemplate: string;
    userLimit: number;
    maxChannels: number;
  };
}

export interface TempVoiceChannelRef {
  channelId: string;
  guildId: string;
  ownerId: string;
}

export type AutomodRule = "spam" | "invite" | "link" | "word";

export interface VoiceLogEntry {
  userId: string;
  userTag: string | null;
  action: VoiceLogAction;
  channelId: string | null;
  fromChannelId: string | null;
}

export interface PresenceCounts {
  online: number;
  idle: number;
  dnd: number;
  offline: number;
}

export interface HeartbeatPayload {
  guildCount: number;
  wsPing: number | null;
  /** Per-guild presence counts; omitted/empty until the Presence intent is on. */
  presence?: Record<string, PresenceCounts>;
}

export interface ChannelActivityEntry {
  channelId: string;
  day: string;
  messageCount: number;
  voiceSeconds: number;
}

export interface WorkerApi {
  getGuildConfig(guildId: string): Promise<GuildGatewayConfig | null>;
  /** guildCreate (M25): upsert the guild row so the panel shows it immediately. */
  postGuildInstalled(guildId: string, payload: { name: string; icon: string | null }): Promise<void>;
  /** guildDelete (M25): mark bot_installed=0 (data is kept). */
  postGuildUninstalled(guildId: string): Promise<void>;
  postHeartbeat(payload: HeartbeatPayload): Promise<void>;
  postEvent(guildId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
  postAutomodSanction(guildId: string, payload: { userId: string; rule: AutomodRule; action: "warn" | "timeout" }): Promise<void>;
  postXp(guildId: string, payload: { userId: string; username: string | null; channelId: string }): Promise<void>;
  /** Voice XP tick (M22): every currently-eligible voice member for this guild. */
  postVoiceXp(guildId: string, entries: Array<{ userId: string; username: string | null; channelId: string }>): Promise<void>;
  /** Starboard (M23): current effective star count of a message. */
  postStarboard(
    guildId: string,
    payload: {
      messageId: string;
      channelId: string;
      authorTag: string;
      authorAvatarUrl: string | null;
      content: string | null;
      imageUrl: string | null;
      count: number;
    },
  ): Promise<void>;
  /** Buffers voice entries and flushes them to the Worker every ~5 s (smooths bursts). */
  postVoiceLogs(guildId: string, entries: VoiceLogEntry[]): Promise<void>;
  postMemberSnapshot(guildId: string, payload: { bucket: string; total: number; humans: number; bots: number }): Promise<void>;
  postChannelActivity(guildId: string, entries: ChannelActivityEntry[]): Promise<void>;
  postMusicState(guildId: string, state: MusicStateDto): Promise<void>;
  savePlaylist(guildId: string, payload: { ownerId: string; name: string; tracks: MusicTrack[] }): Promise<void>;
  getPlaylistTracks(guildId: string, name: string): Promise<MusicTrack[] | null>;
  /** Temp voice (M26): all registered temp channels (startup reconciliation). */
  listAllTempVoiceChannels(): Promise<TempVoiceChannelRef[]>;
  /** Temp voice (M26): current count for a guild (cap check before creating). */
  countTempVoiceChannels(guildId: string): Promise<number>;
  registerTempVoiceChannel(guildId: string, payload: { channelId: string; ownerId: string }): Promise<void>;
  unregisterTempVoiceChannel(guildId: string, channelId: string): Promise<void>;
  postTempVoiceLobbyDeleted(guildId: string): Promise<void>;
}

export function createWorkerApi(env: GatewayEnv): WorkerApi {
  async function call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${env.WORKER_ORIGIN}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.INTERNAL_API_TOKEN}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`worker ${method} ${path} -> ${res.status}`);
    }
    return res;
  }

  // Voice logs are bursty (a full channel emptying fires many events at once):
  // buffer per guild and flush every 5 s, batched ≤50 (the /internal cap).
  const voiceBuffer = new Map<string, VoiceLogEntry[]>();
  async function flushVoice(): Promise<void> {
    for (const [guildId, entries] of voiceBuffer) {
      if (entries.length === 0) {
        voiceBuffer.delete(guildId);
        continue;
      }
      const batch = entries.splice(0, 50);
      try {
        await call("POST", `/internal/guilds/${guildId}/voice-logs`, { entries: batch });
      } catch (err) {
        // Best-effort: drop the batch rather than let the buffer grow unbounded.
        console.error(`voice-logs flush ${guildId} failed:`, errMsg(err));
      }
    }
  }
  setInterval(() => void flushVoice(), 5000);

  return {
    async getGuildConfig(guildId) {
      const res = await call("GET", `/internal/guilds/${guildId}/config`);
      if (res.status === 404) return null;
      return (await res.json()) as GuildGatewayConfig;
    },
    async postGuildInstalled(guildId, payload) {
      await call("POST", `/internal/guilds/${guildId}/installed`, payload);
    },
    async postGuildUninstalled(guildId) {
      await call("POST", `/internal/guilds/${guildId}/uninstalled`);
    },
    async postHeartbeat(payload) {
      await call("POST", "/internal/gateway/heartbeat", payload);
    },
    async postEvent(guildId, eventType, payload) {
      await call("POST", `/internal/guilds/${guildId}/events`, { eventType, payload });
    },
    async postAutomodSanction(guildId, payload) {
      await call("POST", `/internal/guilds/${guildId}/automod-sanctions`, payload);
    },
    async postXp(guildId, payload) {
      await call("POST", `/internal/guilds/${guildId}/xp`, payload);
    },
    async postVoiceXp(guildId, entries) {
      await call("POST", `/internal/guilds/${guildId}/voice-xp`, { entries });
    },
    async postStarboard(guildId, payload) {
      await call("POST", `/internal/guilds/${guildId}/starboard`, payload);
    },
    async postVoiceLogs(guildId, entries) {
      const buf = voiceBuffer.get(guildId) ?? [];
      buf.push(...entries);
      voiceBuffer.set(guildId, buf);
    },
    async postMemberSnapshot(guildId, payload) {
      await call("POST", `/internal/guilds/${guildId}/member-snapshots`, payload);
    },
    async postChannelActivity(guildId, entries) {
      await call("POST", `/internal/guilds/${guildId}/channel-activity`, { entries });
    },
    async postMusicState(guildId, state) {
      await call("POST", `/internal/guilds/${guildId}/music-state`, state);
    },
    async savePlaylist(guildId, payload) {
      await call("POST", `/internal/guilds/${guildId}/playlists`, payload);
    },
    async getPlaylistTracks(guildId, name) {
      const res = await call("GET", `/internal/guilds/${guildId}/playlists/${encodeURIComponent(name)}`);
      if (res.status === 404) return null;
      return ((await res.json()) as { tracks: MusicTrack[] }).tracks;
    },
    async listAllTempVoiceChannels() {
      const res = await call("GET", "/internal/temp-voice/channels");
      return ((await res.json()) as { channels: TempVoiceChannelRef[] }).channels;
    },
    async countTempVoiceChannels(guildId) {
      const res = await call("GET", `/internal/guilds/${guildId}/temp-voice/channels`);
      return ((await res.json()) as { count: number }).count;
    },
    async registerTempVoiceChannel(guildId, payload) {
      await call("POST", `/internal/guilds/${guildId}/temp-voice/channels`, payload);
    },
    async unregisterTempVoiceChannel(guildId, channelId) {
      await call("DELETE", `/internal/guilds/${guildId}/temp-voice/channels/${channelId}`);
    },
    async postTempVoiceLobbyDeleted(guildId) {
      await call("POST", `/internal/guilds/${guildId}/temp-voice/lobby-deleted`);
    },
  };
}
