import type { GatewayEnv } from "./env.js";

/**
 * Typed client for the Worker's /internal/* API — the gateway's ONLY way to
 * read or write bot state (the Worker stays the single D1 writer).
 */

export interface GuildGatewayConfig {
  id: string;
  logChannelId: string | null;
  warnThreshold: number;
  warnTimeoutMinutes: number;
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
  };
}

export type AutomodRule = "spam" | "invite" | "link" | "word";

export interface HeartbeatPayload {
  guildCount: number;
  wsPing: number | null;
}

export interface WorkerApi {
  getGuildConfig(guildId: string): Promise<GuildGatewayConfig | null>;
  postHeartbeat(payload: HeartbeatPayload): Promise<void>;
  postEvent(guildId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
  postAutomodSanction(guildId: string, payload: { userId: string; rule: AutomodRule; action: "warn" | "timeout" }): Promise<void>;
  postXp(guildId: string, payload: { userId: string; username: string | null; channelId: string }): Promise<void>;
}

export function createWorkerApi(env: GatewayEnv): WorkerApi {
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
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

  return {
    async getGuildConfig(guildId) {
      const res = await call("GET", `/internal/guilds/${guildId}/config`);
      if (res.status === 404) return null;
      return (await res.json()) as GuildGatewayConfig;
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
  };
}
