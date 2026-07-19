import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Playlist, Song, type ResolveOptions } from "distube";
import { YtDlpPlugin } from "@distube/yt-dlp";
import { GatewayYtDlpPlugin } from "../src/music.js";
import { PlaylistLoader } from "../src/music/playlist-loader.js";

const require = createRequire(import.meta.url);
const { Playlist: CommonJsPlaylist, Song: CommonJsSong } = require("distube") as {
  Playlist: typeof Playlist;
  Song: typeof Song;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const resolveOptions: ResolveOptions<{ requestId: string }> = {
  metadata: { requestId: "playlist-test" },
};

describe("GatewayYtDlpPlugin — ESM playlist compatibility", () => {
  it("rebuilds a CommonJS playlist and all of its songs as ESM objects without resolving tracks", async () => {
    const plugin = new GatewayYtDlpPlugin({ update: false });
    const metadata = { requestId: "preserved-metadata" };
    const commonJsSongs = Array.from(
      { length: 15 },
      (_, index) =>
        new CommonJsSong<{ requestId: string }>(
          {
            plugin,
            source: "soundcloud",
            playFromSource: true,
            id: `track-${index + 1}`,
            name: index === 0 ? "Ninho - Intro (Jefe)" : `Track ${index + 1}`,
            url: `https://soundcloud.com/drilleurope/track-${index + 1}`,
            isLive: false,
            thumbnail: `https://images.example/track-${index + 1}.jpg`,
            duration: index === 0 ? 164.622 : 180 + index,
            uploader: {
              name: "Ninho",
              url: "https://soundcloud.com/drilleurope",
            },
            views: 1_000 + index,
            likes: 100 + index,
            dislikes: index,
            reposts: 10 + index,
            ageRestricted: false,
          },
          { metadata },
        ),
    );
    const commonJsPlaylist = new CommonJsPlaylist<{ requestId: string }>(
      {
        source: "soundcloud",
        songs: commonJsSongs,
        id: "ninho-jefe-album",
        name: "Ninho - Jefe Album",
        url: "https://soundcloud.com/drilleurope/sets/ninho-jefe-album",
        thumbnail: "https://images.example/cover.jpg",
      },
      { metadata },
    );
    const superResolve = vi.spyOn(YtDlpPlugin.prototype, "resolve").mockResolvedValue(commonJsPlaylist);
    const streamResolve = vi
      .spyOn(plugin, "getStreamURL")
      .mockResolvedValue("https://media.example/first-track");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await plugin.resolve(commonJsPlaylist.url!, resolveOptions);

    expect(superResolve).toHaveBeenCalledOnce();
    expect(superResolve).toHaveBeenCalledWith(commonJsPlaylist.url, resolveOptions);
    expect(streamResolve).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(Playlist);
    expect(result).not.toBe(commonJsPlaylist);

    const playlist = result as Playlist<{ requestId: string }>;
    expect(playlist.songs).toHaveLength(15);
    expect(playlist.songs.map((song) => song.id)).toEqual(commonJsSongs.map((song) => song.id));
    expect(playlist.songs.every((song) => song instanceof Song)).toBe(true);
    expect(playlist.songs.every((song) => !(song instanceof CommonJsSong))).toBe(true);
    expect(playlist.songs.every((song) => song.playlist === playlist)).toBe(true);
    expect(playlist.name).toBe("Ninho - Jefe Album");
    expect(playlist.url).toBe(commonJsPlaylist.url);
    expect(playlist.thumbnail).toBe(commonJsPlaylist.thumbnail);
    expect(playlist.metadata).toBe(metadata);

    const first = playlist.songs[0]!;
    const commonJsFirst = commonJsSongs[0]!;
    expect(first.name).toBe(commonJsFirst.name);
    expect(first.url).toBe(commonJsFirst.url);
    expect(first.duration).toBe(commonJsFirst.duration);
    expect(first.thumbnail).toBe(commonJsFirst.thumbnail);
    expect(first.uploader).toEqual(commonJsFirst.uploader);
    expect(first.views).toBe(commonJsFirst.views);
    expect(first.likes).toBe(commonJsFirst.likes);
    expect(first.dislikes).toBe(commonJsFirst.dislikes);
    expect(first.reposts).toBe(commonJsFirst.reposts);
    expect(first.ageRestricted).toBe(commonJsFirst.ageRestricted);
    expect(first.metadata).toBe(metadata);
    expect(first.plugin).toBe(plugin);
    expect(first.stream.playFromSource).toBe(true);

    const streamUrl = await plugin.getStreamURL(first);

    expect(streamUrl).toBe("https://media.example/first-track");
    expect(streamResolve).toHaveBeenCalledOnce();
    expect(streamResolve).toHaveBeenCalledWith(first);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a direct CommonJS Song by identity and still calls super.resolve exactly once", async () => {
    const plugin = new GatewayYtDlpPlugin({ update: false });
    const directSong = new CommonJsSong({
      plugin,
      source: "soundcloud",
      playFromSource: true,
      id: "niska-reseaux",
      name: "Niska - Réseaux",
      url: "https://soundcloud.com/niska/reseaux",
      duration: 175,
    });
    const superResolve = vi.spyOn(YtDlpPlugin.prototype, "resolve").mockResolvedValue(directSong);
    const streamResolve = vi.spyOn(plugin, "getStreamURL");

    const result = await plugin.resolve(directSong.url!, {});

    expect(superResolve).toHaveBeenCalledOnce();
    expect(superResolve).toHaveBeenCalledWith(directSong.url, {});
    expect(streamResolve).not.toHaveBeenCalled();
    expect(result).toBe(directSong);
  });

  it("keeps saved-playlist ESM Songs lazily resolvable by the installed yt-dlp plugin", async () => {
    const plugin = new GatewayYtDlpPlugin({ update: false });
    const getStreamURL = vi
      .spyOn(plugin, "getStreamURL")
      .mockResolvedValue("https://media.example/lazy-first-track");
    const loader = new PlaylistLoader();
    const session = loader.start("g1", "lazy-soundcloud");
    const metadata = { musicTrace: { actionId: "lazy-soundcloud" } };

    const { playlist } = loader.build(
      session,
      [
        {
          title: "Ninho - Sky Priority (Jefe)",
          url: "https://soundcloud.com/drilleurope/ninho-sky-priority-jefe",
          duration: 153,
          thumbnail: "https://images.example/sky-priority.jpg",
          requestedBy: null,
        },
        {
          title: "Ninho - Jefe",
          url: "https://soundcloud.com/drilleurope/ninho-jefe",
          duration: 177,
          thumbnail: null,
          requestedBy: null,
        },
      ],
      {
        name: "Album Jefe",
        primarySource: "soundcloud",
        plugins: [plugin],
        metadata,
      },
    );

    expect(playlist).toBeInstanceOf(Playlist);
    expect(playlist!.songs.every((song) => song instanceof Song)).toBe(true);
    expect(playlist!.songs.every((song) => song.plugin === plugin)).toBe(true);
    expect(playlist!.songs.every((song) => song.metadata === metadata)).toBe(true);
    expect(playlist!.songs.every((song) => song.stream.playFromSource)).toBe(true);
    expect(playlist!.songs.every((song) => song.stream.url === undefined)).toBe(true);
    expect(getStreamURL).not.toHaveBeenCalled();

    await plugin.getStreamURL(playlist!.songs[0]!);

    expect(getStreamURL).toHaveBeenCalledOnce();
    expect(getStreamURL).toHaveBeenCalledWith(playlist!.songs[0]);
    expect(playlist!.songs[1]!.stream.url).toBeUndefined();
    loader.finish(session);
    expect(loader.activeCount).toBe(0);
  });
});
