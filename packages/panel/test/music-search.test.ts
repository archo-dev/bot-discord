import { describe, expect, it, vi } from "vitest";
import {
  MUSIC_SEARCH_DEBOUNCE_MS,
  MUSIC_SEARCH_MAX_LENGTH,
  MusicSearchCoordinator,
  MusicSubmissionGuard,
} from "../src/lib/music-search.js";

describe("panel music search coordination", () => {
  it("keeps search inputs and debounce bounded", () => {
    expect(MUSIC_SEARCH_MAX_LENGTH).toBe(500);
    expect(MUSIC_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
  });

  it("aborts an obsolete request and accepts only the newest generation", () => {
    const coordinator = new MusicSearchCoordinator();
    const first = coordinator.begin();
    const abort = vi.fn();
    first.signal.addEventListener("abort", abort);
    const second = coordinator.begin();
    expect(abort).toHaveBeenCalledOnce();
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it("cancels the active browser request on cleanup", () => {
    const coordinator = new MusicSearchCoordinator();
    const request = coordinator.begin();
    coordinator.cancel();
    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
  });

  it("rejects a double enqueue until the first submission settles", () => {
    const guard = new MusicSubmissionGuard();
    expect(guard.begin()).toBe(true);
    expect(guard.begin()).toBe(false);
    guard.end();
    expect(guard.begin()).toBe(true);
  });
});
