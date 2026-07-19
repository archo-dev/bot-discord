import { DisTubeError, Playlist, Song, type DisTube } from "distube";
import { describe, expect, it, vi } from "vitest";
import { TrackResolver, PANEL_SEARCH_TIMEOUT_MS } from "../src/music/track-resolver.js";
import { withSoundcloudPlaybackMetadata, withSoundcloudPlaylistPlaybackMetadata } from "../src/music/soundcloud-playback.js";
import type { MusicActionContext } from "../src/music/instrumentation.js";

function action(guildId = "g1"): MusicActionContext {
  return {
    actionId: `action-${guildId}`,
    action: "search",
    source: "panel",
    guildKey: `key-${guildId}`,
    guildId,
    startedAt: 0,
    detectedTracks: 0,
    addedTracks: 0,
    failedTracks: 0,
    queueEventsLogged: 0,
    queueEventsSuppressed: 0,
    resolutionLogged: false,
    performanceStages: {},
    soundcloudSearches: 0,
    soundcloudSearchYtDlpCalls: 0,
    streamsCreated: 0,
  };
}

function song(index = 0, preview = false): Song {
  return new Song(
    {
      plugin: { getStreamURL: vi.fn() } as never,
      source: "soundcloud",
      playFromSource: true,
      id: `song-${index}`,
      name: `Track ${index}`,
      url: `https://soundcloud.com/artist/track-${index}?signature=secret`,
      duration: 180,
      thumbnail: "https://i1.sndcdn.com/art.jpg?token=secret",
      uploader: { name: "Artist" },
    },
    {
      metadata: withSoundcloudPlaybackMetadata(undefined, {
        classification: preview ? "preview" : "full",
        isPreview: preview,
        previewReason: preview ? "selected_format_id" : null,
        formatId: preview ? "http_mp3_preview" : "http_mp3_128",
        protocol: "https",
        formatNote: null,
        acodec: "mp3",
        abr: 128,
        ext: "mp3",
        extractor: "soundcloud",
        availability: "public",
      }),
    },
  );
}

function resolverFor(resolved: Song | Playlist) {
  const handlerResolve = vi.fn().mockResolvedValue(resolved);
  const soundcloudText = vi.fn().mockResolvedValue("https://soundcloud.com/artist/original");
  const distube = { handler: { resolve: handlerResolve } } as unknown as DisTube;
  return { resolver: new TrackResolver(distube, "soundcloud", soundcloudText), handlerResolve, soundcloudText };
}

describe("TrackResolver — shared panel search engine", () => {
  it("reuses the SoundCloud text resolver and returns one bounded public track preview", async () => {
    const current = resolverFor(song());
    const result = await current.resolver.search("Niska Réseaux", action(), { metadata: { trace: true } });
    expect(current.soundcloudText).toHaveBeenCalledOnce();
    expect(current.handlerResolve).toHaveBeenCalledWith(
      "https://soundcloud.com/artist/original",
      { metadata: { trace: true } },
    );
    expect(result.result).toMatchObject({
      type: "track",
      title: "Track 0",
      author: "Artist",
      playableTrackCount: 1,
      isPreview: false,
      url: "https://soundcloud.com/artist/track-0",
      thumbnail: "https://i1.sndcdn.com/art.jpg",
    });
    expect(JSON.stringify(result)).not.toMatch(/signature=|token=/i);
  });

  it("resolves direct URLs without entering the text-search cache", async () => {
    const current = resolverFor(song());
    await current.resolver.search("https://soundcloud.com/artist/direct", action());
    expect(current.soundcloudText).not.toHaveBeenCalled();
    expect(current.handlerResolve).toHaveBeenCalledWith("https://soundcloud.com/artist/direct", {});
  });

  it("describes a 200-track lazy playlist without resolving any stream", async () => {
    const songs = Array.from({ length: 200 }, (_, index) => song(index, index === 2));
    const metadata = withSoundcloudPlaylistPlaybackMetadata(undefined, songs.map((track, index) => ({
      id: track.id,
      playback: {
        classification: index === 2 ? "preview" : "full",
        isPreview: index === 2,
        previewReason: index === 2 ? "selected_format_id" : null,
        formatId: index === 2 ? "http_mp3_preview" : "http_mp3_128",
        protocol: "https",
        formatNote: null,
        acodec: "mp3",
        abr: 128,
        ext: "mp3",
        extractor: "soundcloud",
        availability: "public",
      },
    })), {
      detected: 204,
      playable: 200,
      ignored: 4,
    });
    const playlist = new Playlist(
      {
        source: "soundcloud",
        songs,
        name: "Large set",
        url: "https://soundcloud.com/artist/sets/large?signature=secret",
      },
      { metadata },
    );
    const current = resolverFor(playlist);
    const preview = await current.resolver.search("https://soundcloud.com/artist/sets/large", action());
    expect(preview.result).toMatchObject({
      type: "playlist",
      title: "Large set",
      playableTrackCount: 200,
      ignoredTrackCount: 4,
      isPreview: true,
      url: "https://soundcloud.com/artist/sets/large",
    });
    for (const track of songs) expect(track.plugin?.getStreamURL).not.toHaveBeenCalled();
  });

  it("enforces the global panel-search timeout", async () => {
    vi.useFakeTimers();
    try {
      const distube = { handler: { resolve: vi.fn(() => new Promise(() => undefined)) } } as unknown as DisTube;
      const resolver = new TrackResolver(distube, "soundcloud", vi.fn());
      const pending = resolver.search("https://soundcloud.com/artist/direct", action());
      const rejection = expect(pending).rejects.toThrow("mis trop de temps");
      await vi.advanceTimersByTimeAsync(PANEL_SEARCH_TIMEOUT_MS);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a clear user error for an empty DisTube result", async () => {
    const distube = {
      handler: { resolve: vi.fn().mockRejectedValue(new DisTubeError("NO_RESULT", "missing")) },
    } as unknown as DisTube;
    const resolver = new TrackResolver(distube, "soundcloud", vi.fn());
    await expect(resolver.search("https://soundcloud.com/artist/missing", action())).rejects.toThrow(
      "Aucun résultat complet et exploitable",
    );
  });
});
