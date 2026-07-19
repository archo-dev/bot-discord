import { describe, expect, it, vi } from "vitest";
import { Playlist, PluginType, Song, type DisTubePlugin } from "distube";
import type { MusicTrack } from "@bot/shared";
import {
  MAX_LAZY_PLAYLIST_TRACKS,
  PlaylistLoader,
  PlaylistLoadCancelledError,
} from "../src/music/playlist-loader.js";

function track(index: number): MusicTrack {
  return {
    title: `Track ${index}`,
    url: `https://soundcloud.com/example/track-${index}`,
    duration: 120 + index,
    thumbnail: index === 1 ? "https://images.example/cover.jpg" : null,
    requestedBy: null,
  };
}

function playablePlugin() {
  return {
    type: PluginType.PLAYABLE_EXTRACTOR,
    getStreamURL: vi.fn(async (song: Song) => `https://media.example/${song.id}`),
  } as unknown as DisTubePlugin & { getStreamURL: ReturnType<typeof vi.fn> };
}

function build(loader: PlaylistLoader, count: number, plugin = playablePlugin()) {
  const session = loader.start("g1", `action-${count}`);
  const metadata = { musicTrace: { actionId: `action-${count}` } };
  const result = loader.build(session, Array.from({ length: count }, (_, index) => track(index + 1)), {
    name: `Album ${count}`,
    primarySource: "soundcloud",
    plugins: [plugin],
    metadata,
  });
  return { session, metadata, plugin, ...result };
}

describe("PlaylistLoader — bounded lazy ESM construction", () => {
  it.each([1, 15, 200])("builds %i ordered ESM Songs without resolving a stream", (count) => {
    const loader = new PlaylistLoader();
    const { playlist, summary, plugin, metadata, session } = build(loader, count);

    expect(playlist).toBeInstanceOf(Playlist);
    expect(playlist!.songs).toHaveLength(count);
    expect(playlist!.songs.every((song) => song instanceof Song)).toBe(true);
    expect(playlist!.songs.map((song) => song.name)).toEqual(
      Array.from({ length: count }, (_, index) => `Track ${index + 1}`),
    );
    expect(playlist!.songs.every((song) => song.playlist === playlist)).toBe(true);
    expect(playlist!.songs.every((song) => song.plugin === plugin)).toBe(true);
    expect(playlist!.songs.every((song) => song.metadata === metadata)).toBe(true);
    expect(playlist!.songs.every((song) => song.stream.playFromSource)).toBe(true);
    expect(playlist!.songs.every((song) => !("url" in song.stream) || song.stream.url === undefined)).toBe(true);
    expect(plugin.getStreamURL).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      detected: count,
      validated: count,
      ignored: 0,
      errors: 0,
      truncated: 0,
      maxConcurrentPromises: 0,
    });
    expect(summary.buildDurationMs).toBeGreaterThanOrEqual(0);
    expect(summary.buildDurationMs).toBeLessThan(1_000);
    loader.finish(session);
    expect(loader.activeCount).toBe(0);
  });

  it("caps a load at 200 entries without unbounded work", () => {
    const loader = new PlaylistLoader();
    const { playlist, summary } = build(loader, MAX_LAZY_PLAYLIST_TRACKS + 5);

    expect(playlist!.songs).toHaveLength(MAX_LAZY_PLAYLIST_TRACKS);
    expect(summary).toMatchObject({
      detected: 205,
      validated: 200,
      truncated: 5,
      maxConcurrentPromises: 0,
    });
  });

  it("skips invalid entries and unexpected per-entry failures while preserving valid order", () => {
    const loader = new PlaylistLoader();
    const session = loader.start("g1", "partial-errors");
    const broken = Object.defineProperty({}, "title", {
      get() {
        throw new Error("broken title getter");
      },
    }) as MusicTrack;
    const invalid = { ...track(99), url: "not a public URL" };
    const result = loader.build(session, [invalid, track(1), broken, track(2), invalid, track(3)], {
      name: "Partial",
      primarySource: "soundcloud",
      plugins: [playablePlugin()],
    });

    expect(result.playlist!.songs.map((song) => song.name)).toEqual(["Track 1", "Track 2", "Track 3"]);
    expect(result.summary).toMatchObject({
      detected: 6,
      validated: 3,
      ignored: 2,
      errors: 1,
      firstError: "broken title getter",
    });
  });

  it("returns no Playlist when every entry is invalid", () => {
    const loader = new PlaylistLoader();
    const session = loader.start("g1", "invalid");
    const result = loader.build(
      session,
      [
        { ...track(1), title: "" },
        { ...track(2), url: "not a URL" },
        { ...track(3), url: "https://soundcloud.com/example/sets/not-a-track" },
      ],
      { name: "Invalid", primarySource: "soundcloud", plugins: [playablePlugin()] },
    );

    expect(result.playlist).toBeNull();
    expect(result.summary).toMatchObject({ detected: 3, validated: 0, ignored: 3, errors: 0 });
  });

  it("keeps the first and following Songs independently stream-resolvable only on demand", async () => {
    const loader = new PlaylistLoader();
    const { playlist, plugin } = build(loader, 15);

    expect(plugin.getStreamURL).not.toHaveBeenCalled();
    await plugin.getStreamURL(playlist!.songs[0]!);
    expect(plugin.getStreamURL).toHaveBeenCalledOnce();
    await plugin.getStreamURL(playlist!.songs[1]!);
    expect(plugin.getStreamURL).toHaveBeenCalledTimes(2);
    expect(plugin.getStreamURL).toHaveBeenNthCalledWith(1, playlist!.songs[0]);
    expect(plugin.getStreamURL).toHaveBeenNthCalledWith(2, playlist!.songs[1]);
  });

  it("cancels one guild without affecting another and releases every session", () => {
    const loader = new PlaylistLoader();
    const first = loader.start("g1", "first");
    const second = loader.start("g2", "second");

    expect(loader.cancel("g1", "stop")).toBe(first);
    expect(first.signal.aborted).toBe(true);
    expect(() => loader.assertActive(first)).toThrow(PlaylistLoadCancelledError);
    expect(second.signal.aborted).toBe(false);
    expect(loader.isActive(second)).toBe(true);
    expect(
      loader.build(second, [track(1)], {
        name: "Other guild",
        primarySource: "soundcloud",
        plugins: [playablePlugin()],
      }).playlist,
    ).toBeInstanceOf(Playlist);

    loader.finish(first);
    loader.finish(second);
    expect(loader.activeCount).toBe(0);
  });
});
