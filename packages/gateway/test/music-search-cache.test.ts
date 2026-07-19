import { describe, expect, it, vi } from "vitest";
import {
  SoundcloudSearchCache,
  SoundcloudSearchCacheClearedError,
  SoundcloudSearchCapacityError,
  isCacheableSoundcloudPageUrl,
  soundcloudSearchCacheKey,
} from "../src/music/search-cache.js";

const publicUrl = (slug: string) => `https://soundcloud.com/artist/${slug}`;

describe("SoundcloudSearchCache — bounded latency optimization", () => {
  it("coalesces two identical concurrent searches into one real resolution", async () => {
    const cache = new SoundcloudSearchCache();
    let release!: (value: string) => void;
    const resolver = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    const first = cache.resolve("NÍSKA — Réseaux", resolver);
    const second = cache.resolve("niska reseaux", resolver);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledOnce());
    release(publicUrl("niska-reseaux"));

    expect(await first).toMatchObject({ value: publicUrl("niska-reseaux"), status: "miss" });
    expect(await second).toMatchObject({ value: publicUrl("niska-reseaux"), status: "joined" });
    expect(cache.snapshot()).toMatchObject({ size: 1, misses: 1, joins: 1, inFlight: 0 });
  });

  it("isolates different search keys", async () => {
    const cache = new SoundcloudSearchCache();
    const firstResolver = vi.fn().mockResolvedValue(publicUrl("first"));
    const secondResolver = vi.fn().mockResolvedValue(publicUrl("second"));

    const [first, second] = await Promise.all([
      cache.resolve("first song", firstResolver),
      cache.resolve("second song", secondResolver),
    ]);

    expect(first.value).toBe(publicUrl("first"));
    expect(second.value).toBe(publicUrl("second"));
    expect(firstResolver).toHaveBeenCalledOnce();
    expect(secondResolver).toHaveBeenCalledOnce();
  });

  it("serves a hit until TTL expiry, then resolves a fresh miss", async () => {
    let now = 100;
    const cache = new SoundcloudSearchCache({ ttlMs: 50, now: () => now });
    const resolver = vi.fn().mockResolvedValue(publicUrl("ttl"));

    expect((await cache.resolve("ttl song", resolver)).status).toBe("miss");
    now += 49;
    expect((await cache.resolve("ttl song", resolver)).status).toBe("hit");
    now += 2;
    expect((await cache.resolve("ttl song", resolver)).status).toBe("miss");

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(cache.snapshot()).toMatchObject({ size: 1, hits: 1, misses: 2, expirations: 1 });
  });

  it("uses deterministic LRU eviction and never exceeds its explicit maximum", async () => {
    const cache = new SoundcloudSearchCache({ maxEntries: 2 });
    const resolver = (slug: string) => vi.fn().mockResolvedValue(publicUrl(slug));
    const a = resolver("a");
    const b = resolver("b");
    const c = resolver("c");

    await cache.resolve("a", a);
    await cache.resolve("b", b);
    expect((await cache.resolve("a", a)).status).toBe("hit");
    await cache.resolve("c", c);
    expect(cache.snapshot()).toMatchObject({ size: 2, maxEntries: 2, evictions: 1 });
    expect((await cache.resolve("b", b)).status).toBe("miss");
    expect(b).toHaveBeenCalledTimes(2);
    expect(cache.snapshot().size).toBe(2);
  });

  it("never caches a signed stream URL or a playlist URL", async () => {
    const cache = new SoundcloudSearchCache();
    const signed = "https://media.soundcloud.com/audio?Policy=SECRET&Signature=SECRET";
    const signedResolver = vi.fn().mockResolvedValue(signed);
    const setResolver = vi.fn().mockResolvedValue("https://soundcloud.com/artist/sets/album");

    expect(isCacheableSoundcloudPageUrl(signed)).toBe(false);
    expect(isCacheableSoundcloudPageUrl("https://soundcloud.com/artist/track")).toBe(true);
    expect(isCacheableSoundcloudPageUrl(`https://soundcloud.com/artist/${"x".repeat(600)}`)).toBe(false);
    await cache.resolve("signed", signedResolver);
    await cache.resolve("signed", signedResolver);
    await cache.resolve("set", setResolver);
    await cache.resolve("set", setResolver);

    expect(signedResolver).toHaveBeenCalledTimes(2);
    expect(setResolver).toHaveBeenCalledTimes(2);
    expect(cache.snapshot().size).toBe(0);
  });

  it("uses opaque keys that cannot expose query credentials", () => {
    const secretQuery = "song token=TOKEN_SECRET cookie=COOKIE_SECRET";
    const key = soundcloudSearchCacheKey(secretQuery);

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("TOKEN_SECRET");
    expect(key).not.toContain("COOKIE_SECRET");
    expect(key).not.toContain("song");
  });

  it("does not cache failures and retries normally", async () => {
    const cache = new SoundcloudSearchCache();
    const resolver = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("yt-dlp failed"))
      .mockResolvedValueOnce(publicUrl("recovered"));

    await expect(cache.resolve("retry", resolver)).rejects.toThrow("yt-dlp failed");
    await expect(cache.resolve("retry", resolver)).resolves.toMatchObject({ status: "miss" });
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("bounds simultaneous distinct resolutions", async () => {
    const cache = new SoundcloudSearchCache({ maxConcurrent: 2, maxQueued: 8 });
    let active = 0;
    let maxActive = 0;
    const resolver = (index: number) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return publicUrl(`bounded-${index}`);
    };

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => cache.resolve(`query ${index}`, resolver(index))),
    );

    expect(results).toHaveLength(6);
    expect(maxActive).toBe(2);
    expect(cache.snapshot()).toMatchObject({ maxConcurrent: 2, maxConcurrentObserved: 2, activeResolutions: 0 });
  });

  it("bounds the waiting queue and rejects excess work explicitly", async () => {
    const cache = new SoundcloudSearchCache({ maxConcurrent: 1, maxQueued: 1 });
    let release!: (value: string) => void;
    const active = cache.resolve(
      "active",
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const queued = cache.resolve("queued", async () => publicUrl("queued"));
    await vi.waitFor(() => expect(cache.snapshot()).toMatchObject({ activeResolutions: 1, queuedResolutions: 1 }));

    await expect(cache.resolve("excess", async () => publicUrl("excess"))).rejects.toBeInstanceOf(
      SoundcloudSearchCapacityError,
    );
    release(publicUrl("active"));
    await expect(Promise.all([active, queued])).resolves.toHaveLength(2);
    expect(cache.snapshot()).toMatchObject({ activeResolutions: 0, queuedResolutions: 0 });
  });

  it("cancels queued cache work during cleanup without retaining its resolver", async () => {
    const cache = new SoundcloudSearchCache({ maxConcurrent: 1, maxQueued: 2 });
    let release!: (value: string) => void;
    const active = cache.resolve(
      "active cleanup",
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const queuedResolver = vi.fn().mockResolvedValue(publicUrl("never-started"));
    const queued = cache.resolve("queued cleanup", queuedResolver);
    await vi.waitFor(() => expect(cache.snapshot().queuedResolutions).toBe(1));

    cache.clear();

    await expect(queued).rejects.toBeInstanceOf(SoundcloudSearchCacheClearedError);
    expect(queuedResolver).not.toHaveBeenCalled();
    release(publicUrl("active-cleanup"));
    await active;
    expect(cache.snapshot()).toMatchObject({ size: 0, inFlight: 0, queuedResolutions: 0 });
  });

  it("clears cached state and prevents an in-flight result from being inserted late", async () => {
    const cache = new SoundcloudSearchCache();
    let release!: (value: string) => void;
    const resolver = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const pending = cache.resolve("late", resolver);
    await vi.waitFor(() => expect(cache.snapshot().inFlight).toBe(1));

    cache.clear();
    release(publicUrl("late"));
    await expect(pending).resolves.toMatchObject({ status: "miss" });

    expect(cache.snapshot()).toMatchObject({ size: 0, inFlight: 0, queuedResolutions: 0 });
    await cache.resolve("late", resolver.mockResolvedValue(publicUrl("fresh")));
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
