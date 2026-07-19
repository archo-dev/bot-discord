import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/lib/api.js";
import {
  MUSIC_SEARCH_DEBOUNCE_MS,
  MUSIC_SEARCH_MAX_LENGTH,
  MUSIC_SEARCH_MIN_LENGTH,
  MusicSearchCoordinator,
  MusicSubmissionGuard,
  musicSearchErrorMessage,
  normalizeMusicSearchQuery,
} from "../src/lib/music-search.js";

describe("panel music search coordination", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps search inputs and debounce bounded", () => {
    expect(MUSIC_SEARCH_MAX_LENGTH).toBe(500);
    expect(MUSIC_SEARCH_MIN_LENGTH).toBe(3);
    expect(MUSIC_SEARCH_DEBOUNCE_MS).toBe(700);
    expect(normalizeMusicSearchQuery("  Freeze   Corleone ")).toBe("Freeze Corleone");
  });

  it("sends no request for empty or short input and one request for stabilized typing", async () => {
    vi.useFakeTimers();
    const coordinator = new MusicSearchCoordinator();
    const run = vi.fn();
    expect(coordinator.schedule("", "g1", run)).toBe("ignored");
    expect(coordinator.schedule("a", "g1", run)).toBe("ignored");
    expect(coordinator.schedule("ab", "g1", run)).toBe("ignored");
    expect(coordinator.schedule("Nis", "g1", run)).toBe("scheduled");
    await vi.advanceTimersByTimeAsync(MUSIC_SEARCH_DEBOUNCE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toBe("Nis");
  });

  it("coalesces rapid typing and duplicate effects into one final request", async () => {
    vi.useFakeTimers();
    const coordinator = new MusicSearchCoordinator();
    const run = vi.fn();
    coordinator.schedule("fre", "g1", run);
    await vi.advanceTimersByTimeAsync(200);
    coordinator.schedule("free", "g1", run);
    await vi.advanceTimersByTimeAsync(200);
    coordinator.schedule("freeze", "g1", run);
    expect(coordinator.schedule("freeze", "g1", run)).toBe("duplicate");
    await vi.advanceTimersByTimeAsync(MUSIC_SEARCH_DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toBe("freeze");
  });

  it("aborts an in-flight obsolete request and never retries it automatically", async () => {
    vi.useFakeTimers();
    const coordinator = new MusicSearchCoordinator();
    const requests: Array<{ query: string; signal: AbortSignal; current: () => boolean }> = [];
    const run = vi.fn((query: string, request: { signal: AbortSignal; isCurrent: () => boolean }) => {
      requests.push({ query, signal: request.signal, current: request.isCurrent });
    });
    coordinator.schedule("first", "g1", run);
    await vi.advanceTimersByTimeAsync(MUSIC_SEARCH_DEBOUNCE_MS);
    expect(run).toHaveBeenCalledOnce();
    coordinator.schedule("second", "g1", run);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[0]?.current()).toBe(false);
    await vi.advanceTimersByTimeAsync(MUSIC_SEARCH_DEBOUNCE_MS * 4);
    expect(run).toHaveBeenCalledTimes(2);
    expect(requests[1]?.query).toBe("second");
  });

  it("keeps coordinators isolated across two tabs and allows a fresh search after clearing", async () => {
    vi.useFakeTimers();
    const firstTab = new MusicSearchCoordinator();
    const secondTab = new MusicSearchCoordinator();
    const firstRun = vi.fn();
    const secondRun = vi.fn();
    firstTab.schedule("ninho", "g1", firstRun);
    secondTab.schedule("ninho", "g1", secondRun);
    await vi.advanceTimersByTimeAsync(MUSIC_SEARCH_DEBOUNCE_MS);
    expect(firstRun).toHaveBeenCalledOnce();
    expect(secondRun).toHaveBeenCalledOnce();
    firstTab.schedule("", "g1", firstRun);
    firstTab.schedule("ninho", "g1", firstRun);
    await vi.advanceTimersByTimeAsync(MUSIC_SEARCH_DEBOUNCE_MS);
    expect(firstRun).toHaveBeenCalledTimes(2);
  });

  it("renders an exact Retry-After without scheduling a retry", async () => {
    vi.useFakeTimers();
    expect(musicSearchErrorMessage(new ApiError(429, "rate_limited", undefined, 17))).toBe(
      "Trop de recherches. Réessayez dans 17 secondes.",
    );
    expect(musicSearchErrorMessage(new ApiError(429, "rate_limited", undefined, 1))).toBe(
      "Trop de recherches. Réessayez dans 1 seconde.",
    );
    const coordinator = new MusicSearchCoordinator();
    const run = vi.fn();
    coordinator.schedule("search", "g1", run);
    await vi.advanceTimersByTimeAsync(MUSIC_SEARCH_DEBOUNCE_MS * 10);
    expect(run).toHaveBeenCalledOnce();
  });

  it("propagates the Worker Retry-After and performs exactly one fetch on 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "rate_limited", retryAfterSeconds: 23 }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": "23" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    let caught: unknown;
    try {
      await api("/api/guilds/g1/music-search", { method: "POST", body: JSON.stringify({ query: "ninho" }) });
    } catch (error) {
      caught = error;
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(caught).toBeInstanceOf(ApiError);
    expect(musicSearchErrorMessage(caught)).toBe("Trop de recherches. Réessayez dans 23 secondes.");
  });

  it("rejects a double enqueue until the first submission settles", () => {
    const guard = new MusicSubmissionGuard();
    expect(guard.begin()).toBe(true);
    expect(guard.begin()).toBe(false);
    guard.end();
    expect(guard.begin()).toBe(true);
  });
});
