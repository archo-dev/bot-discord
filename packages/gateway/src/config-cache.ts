import type { GuildGatewayConfig, WorkerApi } from "./worker-api.js";

const TTL_MS = 60_000;
// A null (guild unknown to the Worker) is cached briefly so a burst of events
// doesn't hammer the Worker, but not for the full minute: a freshly-added guild
// must recover quickly on the next event.
const NULL_TTL_MS = 5_000;

interface CacheEntry {
  value: GuildGatewayConfig | null;
  expiresAt: number;
}

/**
 * Per-guild config cache (60 s): panel edits land without restarting the
 * gateway, while event handlers (M11+) avoid one Worker round-trip per event.
 *
 * M04 — request coalescing: on a cold cache, N concurrent get() calls for the
 * same guild (a channel emptying fires many events at once) share a SINGLE
 * Worker request instead of triggering N identical /internal/config calls.
 */
export function createConfigCache(api: WorkerApi) {
  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<GuildGatewayConfig | null>>();

  return {
    async get(guildId: string): Promise<GuildGatewayConfig | null> {
      const hit = entries.get(guildId);
      if (hit && hit.expiresAt > Date.now()) return hit.value;

      // Coalesce concurrent misses onto the pending request.
      const pending = inFlight.get(guildId);
      if (pending) return pending;

      const request = (async () => {
        const value = await api.getGuildConfig(guildId);
        entries.set(guildId, { value, expiresAt: Date.now() + (value === null ? NULL_TTL_MS : TTL_MS) });
        return value;
      })();
      inFlight.set(guildId, request);
      try {
        return await request;
      } finally {
        // A rejected request is never cached: the next event retries.
        inFlight.delete(guildId);
      }
    },
    invalidate(guildId: string): void {
      entries.delete(guildId);
      inFlight.delete(guildId);
    },
  };
}

export type ConfigCache = ReturnType<typeof createConfigCache>;
