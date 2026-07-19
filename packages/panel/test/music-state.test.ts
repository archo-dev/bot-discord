import { describe, expect, it } from "vitest";
import type { MusicPlaybackStatus, MusicStateDto } from "@bot/shared";
import {
  MUSIC_ACTIVE_POLL_MS,
  MUSIC_BUFFERING_POLL_MS,
  MUSIC_IDLE_POLL_MS,
  MUSIC_PAUSED_POLL_MS,
  interpolateMusicElapsed,
  musicPollInterval,
  newestMusicState,
} from "../src/lib/music-state.js";

function state(status: MusicPlaybackStatus, sequence: number, elapsed = 10): MusicStateDto {
  return {
    status,
    connected: !["idle", "stopped", "error"].includes(status),
    paused: status === "paused",
    seekable: true,
    current: { title: "Track", url: "https://soundcloud.com/a/b", duration: 100, thumbnail: null, requestedBy: null },
    elapsed,
    queue: [],
    loop: "off",
    volume: 50,
    voiceChannelId: "1",
    sequence,
    updatedAt: sequence,
  };
}

describe("near-real-time music state", () => {
  it("adapts polling to active, buffering, paused, idle and network-loss states", () => {
    expect(musicPollInterval(state("buffering", 1))).toBe(MUSIC_BUFFERING_POLL_MS);
    expect(musicPollInterval(state("playing", 1))).toBe(MUSIC_ACTIVE_POLL_MS);
    expect(musicPollInterval(state("paused", 1))).toBe(MUSIC_PAUSED_POLL_MS);
    expect(musicPollInterval(state("idle", 1))).toBe(MUSIC_IDLE_POLL_MS);
    expect(musicPollInterval(state("playing", 1), 1)).toBe(4_000);
    expect(musicPollInterval(state("playing", 1), 4)).toBe(MUSIC_IDLE_POLL_MS);
    expect(musicPollInterval(state("playing", 1), 0)).toBe(MUSIC_ACTIVE_POLL_MS);
  });

  it("rejects stale snapshots independently in multiple tabs", () => {
    const recent = state("playing", 20, 30);
    const stale = state("buffering", 19, 29);
    const newer = state("paused", 21, 31);

    const tabA = newestMusicState(recent, stale);
    const tabB = newestMusicState(state("playing", 18, 25), stale);
    expect(tabA).toBe(recent);
    expect(tabB).toBe(stale);
    expect(newestMusicState(tabA, newer)).toBe(newer);
    expect(tabB.status).toBe("buffering");
  });

  it("interpolates only Playing and resynchronizes on a newer snapshot", () => {
    expect(interpolateMusicElapsed(state("playing", 1, 10), 2_500)).toBe(12.5);
    expect(interpolateMusicElapsed(state("paused", 2, 10), 2_500)).toBe(10);
    expect(interpolateMusicElapsed(state("buffering", 3, 10), 2_500)).toBe(10);
    expect(interpolateMusicElapsed(state("playing", 4, 99), 5_000)).toBe(100);

    const drifted = state("playing", 5, 20);
    const resynchronized = newestMusicState(drifted, state("playing", 6, 18));
    expect(interpolateMusicElapsed(resynchronized, 0)).toBe(18);
  });
});
