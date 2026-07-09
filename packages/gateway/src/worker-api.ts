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
}

export interface HeartbeatPayload {
  guildCount: number;
  wsPing: number | null;
}

export interface WorkerApi {
  getGuildConfig(guildId: string): Promise<GuildGatewayConfig | null>;
  postHeartbeat(payload: HeartbeatPayload): Promise<void>;
  postEvent(guildId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
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
  };
}
