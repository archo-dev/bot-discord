import { describe, expect, it } from "vitest";
import { UserError, resolvePlayQuery } from "../src/music/format.js";

describe("resolvePlayQuery — SoundCloud primary source", () => {
  const SC = "soundcloud" as const;

  it("flags a plain text search for SoundCloud pre-resolution (raw text kept)", () => {
    expect(resolvePlayQuery("niska reseaux", SC)).toEqual({
      query: "niska reseaux",
      source: "soundcloud",
      soundcloudSearch: true,
    });
  });

  it("plays a soundcloud.com URL directly", () => {
    const url = "https://soundcloud.com/artist/some-track";
    expect(resolvePlayQuery(url, SC)).toEqual({ query: url, source: "soundcloud" });
  });

  it("plays an m./on. soundcloud short URL directly", () => {
    expect(resolvePlayQuery("https://m.soundcloud.com/a/b", SC).source).toBe("soundcloud");
    expect(resolvePlayQuery("https://on.soundcloud.com/xYz", SC).source).toBe("soundcloud");
  });

  it("refuses a youtu.be link with a clean UserError mentioning SoundCloud", () => {
    expect(() => resolvePlayQuery("https://youtu.be/dQw4w9WgXcQ", SC)).toThrow(UserError);
    expect(() => resolvePlayQuery("https://youtu.be/dQw4w9WgXcQ", SC)).toThrow(/SoundCloud/i);
    expect(() => resolvePlayQuery("https://youtu.be/dQw4w9WgXcQ", SC)).toThrow(/indisponible/i);
  });

  it("refuses a youtube.com/watch link with a UserError (no aggressive extraction)", () => {
    expect(() => resolvePlayQuery("https://www.youtube.com/watch?v=dQw4w9WgXcQ", SC)).toThrow(UserError);
    expect(() => resolvePlayQuery("https://music.youtube.com/watch?v=abc", SC)).toThrow(UserError);
  });

  it("passes a Spotify URL through untouched (handled by the Spotify plugin)", () => {
    const sp = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";
    expect(resolvePlayQuery(sp, SC)).toEqual({ query: sp, source: "url" });
  });

  it("rejects an empty input", () => {
    expect(() => resolvePlayQuery("   ", SC)).toThrow(UserError);
  });
});

describe("resolvePlayQuery — YouTube primary source (default, unchanged)", () => {
  const YT = "youtube" as const;

  it("cleans a YouTube watch+mix URL down to the bare video", () => {
    expect(
      resolvePlayQuery("https://www.youtube.com/watch?v=4AUExg0Pjlg&list=RD4AUExg0Pjlg&start_radio=1", YT),
    ).toEqual({ query: "https://www.youtube.com/watch?v=4AUExg0Pjlg", source: "youtube" });
  });

  it("leaves a plain text search as-is (yt-dlp --default-search)", () => {
    expect(resolvePlayQuery("niska reseaux", YT)).toEqual({ query: "niska reseaux", source: "youtube" });
  });

  it("still plays SoundCloud URLs even in YouTube mode", () => {
    const url = "https://soundcloud.com/artist/track";
    expect(resolvePlayQuery(url, YT)).toEqual({ query: url, source: "soundcloud" });
  });

  it("still rejects a bare YouTube playlist (via normalizeQuery)", () => {
    expect(() => resolvePlayQuery("https://www.youtube.com/playlist?list=PLabcdef", YT)).toThrow(UserError);
  });
});
