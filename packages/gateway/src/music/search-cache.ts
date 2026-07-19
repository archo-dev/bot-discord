import { createHash } from "node:crypto";

export const SOUNDCLOUD_SEARCH_CACHE_MAX_ENTRIES = 64;
export const SOUNDCLOUD_SEARCH_CACHE_TTL_MS = 30_000;
export const SOUNDCLOUD_SEARCH_MAX_CONCURRENT = 4;
export const SOUNDCLOUD_SEARCH_MAX_QUEUED = 64;
export const SOUNDCLOUD_SEARCH_CACHE_MAX_URL_LENGTH = 512;

export type SoundcloudSearchCacheStatus = "hit" | "miss" | "joined";

export interface SoundcloudSearchCacheResult {
  value: string;
  status: SoundcloudSearchCacheStatus;
  durationMs: number;
}

export interface SoundcloudSearchCacheSnapshot {
  size: number;
  inFlight: number;
  activeResolutions: number;
  queuedResolutions: number;
  maxEntries: number;
  ttlMs: number;
  maxConcurrent: number;
  maxConcurrentObserved: number;
  hits: number;
  misses: number;
  joins: number;
  evictions: number;
  expirations: number;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface SearchCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  maxConcurrent?: number;
  maxQueued?: number;
  now?: () => number;
}

export class SoundcloudSearchCapacityError extends Error {
  constructor() {
    super("SoundCloud search capacity reached");
  }
}

export class SoundcloudSearchCacheClearedError extends Error {
  constructor() {
    super("SoundCloud search cache cleared");
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeSearchText(query: string): string {
  return query
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** A stable opaque key: raw queries and accidental credentials never enter a Map key. */
export function soundcloudSearchCacheKey(query: string): string {
  return createHash("sha256").update(normalizeSearchText(query)).digest("hex");
}

/** Only cache stable public page URLs, never signed/CDN stream URLs. */
export function isCacheableSoundcloudPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const pathSegments = url.pathname.split("/").filter(Boolean);
    return (
      value.length <= SOUNDCLOUD_SEARCH_CACHE_MAX_URL_LENGTH &&
      url.protocol === "https:" &&
      host === "soundcloud.com" &&
      pathSegments.length >= 2 &&
      !url.search &&
      !url.hash &&
      !/\/sets(?:\/|$)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Short, bounded LRU cache for public SoundCloud text-search results.
 * It owns no timers or streams. Concurrent identical misses share one promise;
 * distinct misses pass through a small semaphore so yt-dlp cannot fan out
 * without a bound.
 */
export class SoundcloudSearchCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly waiters: Waiter[] = [];
  private activeResolutions = 0;
  private maxConcurrentObserved = 0;
  private generation = 0;
  private hits = 0;
  private misses = 0;
  private joins = 0;
  private evictions = 0;
  private expirations = 0;

  constructor(options: SearchCacheOptions = {}) {
    this.maxEntries = positiveInteger(options.maxEntries, SOUNDCLOUD_SEARCH_CACHE_MAX_ENTRIES);
    this.ttlMs = positiveInteger(options.ttlMs, SOUNDCLOUD_SEARCH_CACHE_TTL_MS);
    this.maxConcurrent = positiveInteger(options.maxConcurrent, SOUNDCLOUD_SEARCH_MAX_CONCURRENT);
    this.maxQueued = positiveInteger(options.maxQueued, SOUNDCLOUD_SEARCH_MAX_QUEUED);
    this.now = options.now ?? (() => performance.now());
  }

  async resolve(query: string, resolver: () => Promise<string>): Promise<SoundcloudSearchCacheResult> {
    const startedAt = this.now();
    const key = soundcloudSearchCacheKey(query);
    this.pruneExpired();

    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      this.hits++;
      return { value: cached.value, status: "hit", durationMs: this.now() - startedAt };
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      this.joins++;
      return { value: await pending, status: "joined", durationMs: this.now() - startedAt };
    }

    this.misses++;
    const generation = this.generation;
    const request = this.runBounded(resolver).then((value) => {
      if (generation === this.generation && isCacheableSoundcloudPageUrl(value)) this.store(key, value);
      return value;
    });
    this.inFlight.set(key, request);
    try {
      return { value: await request, status: "miss", durationMs: this.now() - startedAt };
    } finally {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    }
  }

  clear(): void {
    this.generation++;
    this.entries.clear();
    this.inFlight.clear();
    const error = new SoundcloudSearchCacheClearedError();
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  snapshot(): SoundcloudSearchCacheSnapshot {
    this.pruneExpired();
    return {
      size: this.entries.size,
      inFlight: this.inFlight.size,
      activeResolutions: this.activeResolutions,
      queuedResolutions: this.waiters.length,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      maxConcurrent: this.maxConcurrent,
      maxConcurrentObserved: this.maxConcurrentObserved,
      hits: this.hits,
      misses: this.misses,
      joins: this.joins,
      evictions: this.evictions,
      expirations: this.expirations,
    };
  }

  private async runBounded<T>(resolver: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await resolver();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.activeResolutions < this.maxConcurrent) {
      this.activeResolutions++;
      this.maxConcurrentObserved = Math.max(this.maxConcurrentObserved, this.activeResolutions);
      return;
    }
    if (this.waiters.length >= this.maxQueued) throw new SoundcloudSearchCapacityError();
    await new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next.resolve();
      return;
    }
    this.activeResolutions = Math.max(0, this.activeResolutions - 1);
  }

  private store(key: string, value: string): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
      this.evictions++;
    }
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) continue;
      this.entries.delete(key);
      this.expirations++;
    }
  }
}
