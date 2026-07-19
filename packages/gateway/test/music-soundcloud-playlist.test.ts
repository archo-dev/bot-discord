import { afterEach, describe, expect, it, vi } from "vitest";
import { Playlist, type ResolveOptions, type Song } from "distube";
import { YtDlpPlugin } from "@distube/yt-dlp";
import { GatewayYtDlpPlugin } from "../src/music.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const resolveOptions: ResolveOptions<{ requestId: string }> = {
  metadata: { requestId: "playlist-test" },
};

describe("GatewayYtDlpPlugin — ESM playlist compatibility", () => {
  it("rebuilds a CommonJS-like playlist as the Gateway Playlist without resolving tracks", async () => {
    const songs = Array.from({ length: 15 }, (_, index) => ({
      name: index === 0 ? "Ninho - Intro (Jefe)" : `Track ${index + 1}`,
      duration: index === 0 ? 164.622 : 180,
    })) as unknown as Song<{ requestId: string }>[];
    const metadata = { requestId: "preserved-metadata" };
    const commonJsLikePlaylist = {
      source: "soundcloud",
      songs,
      id: "ninho-jefe-album",
      name: "Ninho - Jefe Album",
      url: "https://soundcloud.com/drilleurope/sets/ninho-jefe-album",
      thumbnail: "https://images.example/cover.jpg",
      metadata,
    };
    const superResolve = vi
      .spyOn(YtDlpPlugin.prototype, "resolve")
      .mockResolvedValue(commonJsLikePlaylist as unknown as Playlist<{ requestId: string }>);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await new GatewayYtDlpPlugin({ update: false }).resolve(
      commonJsLikePlaylist.url,
      resolveOptions,
    );

    expect(superResolve).toHaveBeenCalledOnce();
    expect(superResolve).toHaveBeenCalledWith(commonJsLikePlaylist.url, resolveOptions);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(Playlist);
    expect(result).not.toBe(commonJsLikePlaylist);
    expect((result as Playlist<{ requestId: string }>).songs).toHaveLength(15);
    expect((result as Playlist<{ requestId: string }>).songs).toBe(songs);
    expect((result as Playlist<{ requestId: string }>).name).toBe("Ninho - Jefe Album");
    expect((result as Playlist<{ requestId: string }>).songs[0]!.name).toBe("Ninho - Intro (Jefe)");
    expect((result as Playlist<{ requestId: string }>).url).toBe(commonJsLikePlaylist.url);
    expect((result as Playlist<{ requestId: string }>).thumbnail).toBe(commonJsLikePlaylist.thumbnail);
    expect((result as Playlist<{ requestId: string }>).metadata).toBe(metadata);
  });

  it("returns a direct Song unchanged and still calls super.resolve exactly once", async () => {
    const directSong = { name: "Niska - Réseaux", duration: 175 } as unknown as Song;
    const superResolve = vi.spyOn(YtDlpPlugin.prototype, "resolve").mockResolvedValue(directSong);

    const result = await new GatewayYtDlpPlugin({ update: false }).resolve(
      "https://soundcloud.com/niska/reseaux",
      {},
    );

    expect(superResolve).toHaveBeenCalledOnce();
    expect(result).toBe(directSong);
  });
});
