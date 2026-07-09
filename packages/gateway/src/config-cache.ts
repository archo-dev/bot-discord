import type { GuildGatewayConfig, WorkerApi } from "./worker-api.js";

const TTL_MS = 60_000;

interface CacheEntry {
  value: GuildGatewayConfig | null;
  expiresAt: number;
}

/**
 * Per-guild config cache (60 s): panel edits land without restarting the
 * gateway, while event handlers (M11+) avoid one Worker round-trip per event.
 */
export function createConfigCache(api: WorkerApi) {
  const entries = new Map<string, CacheEntry>();

  return {
    async get(guildId: string): Promise<GuildGatewayConfig | null> {
      const hit = entries.get(guildId);
      if (hit && hit.expiresAt > Date.now()) return hit.value;
      const value = await api.getGuildConfig(guildId);
      entries.set(guildId, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    },
    invalidate(guildId: string): void {
      entries.delete(guildId);
    },
  };
}

export type ConfigCache = ReturnType<typeof createConfigCache>;
