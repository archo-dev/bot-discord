import { describe, expect, it, vi } from "vitest";
import { createConfigCache } from "../src/config-cache.js";
import type { GuildGatewayConfig, WorkerApi } from "../src/worker-api.js";

/*
 * Coalescence du cache de config (M04). Sur cache froid, une rafale d'événements
 * pour la même guilde ne doit déclencher qu'UN appel Worker, pas N.
 */

function fakeConfig(id: string): GuildGatewayConfig {
  return { id } as unknown as GuildGatewayConfig;
}

/** WorkerApi minimal : seul getGuildConfig est exercé ; il compte ses appels. */
function stubApi(impl: (guildId: string) => Promise<GuildGatewayConfig | null>): {
  api: WorkerApi;
  calls: () => number;
} {
  const getGuildConfig = vi.fn(impl);
  const api = { getGuildConfig } as unknown as WorkerApi;
  return { api, calls: () => getGuildConfig.mock.calls.length };
}

describe("config cache — coalescence", () => {
  it("collapses concurrent cold-cache reads of the same guild into one Worker call", async () => {
    let resolveFetch!: (v: GuildGatewayConfig) => void;
    const { api, calls } = stubApi(
      () => new Promise<GuildGatewayConfig>((resolve) => { resolveFetch = resolve; }),
    );
    const cache = createConfigCache(api);

    // 10 events land at once on a cold cache before the Worker responds.
    const inflight = Promise.all(Array.from({ length: 10 }, () => cache.get("123")));
    resolveFetch(fakeConfig("123"));
    const results = await inflight;

    expect(calls()).toBe(1);
    expect(results.every((r) => r?.id === "123")).toBe(true);
  });

  it("serves later reads from cache without another call, and isolates per guild", async () => {
    const { api, calls } = stubApi(async (guildId) => fakeConfig(guildId));
    const cache = createConfigCache(api);

    await cache.get("a");
    await cache.get("a"); // warm hit
    await cache.get("b"); // different guild → its own call

    expect(calls()).toBe(2);
  });

  it("does not cache a rejected request (next event retries)", async () => {
    let attempt = 0;
    const { api, calls } = stubApi(async () => {
      attempt++;
      if (attempt === 1) throw new Error("worker down");
      return fakeConfig("z");
    });
    const cache = createConfigCache(api);

    await expect(cache.get("z")).rejects.toThrow("worker down");
    const recovered = await cache.get("z");

    expect(recovered?.id).toBe("z");
    expect(calls()).toBe(2);
  });
});
