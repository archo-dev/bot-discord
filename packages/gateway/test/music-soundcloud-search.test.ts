import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SC_SEARCH_TIMEOUT_MS,
  UserError,
  pickSoundcloudTrackUrl,
  resolveSoundcloudSearch,
} from "../src/music/format.js";

/** A scsearch1 dump-single-json result with one SoundCloud track. */
const oneResult = {
  _type: "playlist",
  id: "niska reseaux",
  entries: [{ id: "331851568", title: "Réseaux", webpage_url: "https://soundcloud.com/niska/reseaux", url: "https://cdn" }],
};

describe("pickSoundcloudTrackUrl — pure extraction", () => {
  it("prefers webpage_url of the first entry", () => {
    expect(pickSoundcloudTrackUrl(oneResult)).toBe("https://soundcloud.com/niska/reseaux");
  });

  it("falls back to a http(s) url when webpage_url is missing", () => {
    const info = { entries: [{ url: "https://soundcloud.com/a/track" }] };
    expect(pickSoundcloudTrackUrl(info)).toBe("https://soundcloud.com/a/track");
  });

  it("throws on an empty playlist", () => {
    expect(() => pickSoundcloudTrackUrl({ _type: "playlist", entries: [] })).toThrow(UserError);
    expect(() => pickSoundcloudTrackUrl({ entries: [] })).toThrow(/Aucun résultat SoundCloud/i);
  });

  it("throws on an unexpected shape (no entries array)", () => {
    expect(() => pickSoundcloudTrackUrl({ foo: "bar" })).toThrow(UserError);
    expect(() => pickSoundcloudTrackUrl(null)).toThrow(UserError);
    expect(() => pickSoundcloudTrackUrl("not json")).toThrow(UserError);
  });

  it("throws when the first entry has no valid http url", () => {
    expect(() => pickSoundcloudTrackUrl({ entries: [{ webpage_url: "ftp://x", url: 42 }] })).toThrow(UserError);
    expect(() => pickSoundcloudTrackUrl({ entries: [{}] })).toThrow(UserError);
  });
});

describe("resolveSoundcloudSearch — bounded pre-resolution", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves a text search to the first track's URL and prefixes scsearch1:", async () => {
    const fetchJson = vi.fn().mockResolvedValue(oneResult);
    await expect(resolveSoundcloudSearch("niska reseaux", fetchJson)).resolves.toBe(
      "https://soundcloud.com/niska/reseaux",
    );
    expect(fetchJson).toHaveBeenCalledWith("scsearch1:niska reseaux");
  });

  it("throws a clean UserError when the search has no result", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ _type: "playlist", entries: [] });
    await expect(resolveSoundcloudSearch("zzz", fetchJson)).rejects.toThrowError(UserError);
    await expect(resolveSoundcloudSearch("zzz", fetchJson)).rejects.toThrow(/Aucun résultat SoundCloud/i);
  });

  it("throws a clean UserError on an invalid/unexpected JSON shape", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ nope: true });
    await expect(resolveSoundcloudSearch("x", fetchJson)).rejects.toThrowError(UserError);
  });

  it("logs a SANITISED error and surfaces a UserError when yt-dlp fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchJson = vi
      .fn()
      .mockRejectedValue(new Error("yt-dlp exited 1: cookie: SECRET123 https://x.googlevideo.com/vp?sig=SECRET"));
    await expect(resolveSoundcloudSearch("x", fetchJson)).rejects.toThrowError(UserError);
    expect(spy).toHaveBeenCalledOnce();
    const logged = String(spy.mock.calls[0]![0]);
    expect(logged).not.toContain("SECRET123");
    expect(logged).not.toContain("sig=SECRET");
    expect(logged).toContain("[redacted]");
  });

  it("rejects with a UserError (timeout) if the resolution never settles", async () => {
    vi.useFakeTimers();
    const fetchJson = vi.fn(() => new Promise<unknown>(() => {})); // never resolves
    const p = resolveSoundcloudSearch("x", fetchJson, SC_SEARCH_TIMEOUT_MS);
    const assertion = expect(p).rejects.toThrowError(UserError);
    await vi.advanceTimersByTimeAsync(SC_SEARCH_TIMEOUT_MS + 1);
    await assertion;
    await expect(p).rejects.toThrow(/trop de temps/i);
  });
});
