import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SC_MIN_DURATION_SEC,
  SC_SEARCH_RESULTS,
  SC_SEARCH_TIMEOUT_MS,
  UserError,
  pickPlayableSoundcloudUrl,
  resolveSoundcloudSearch,
} from "../src/music/format.js";

const scUrl = (slug: string) => `https://soundcloud.com/${slug}`;
const track = (over: Record<string, unknown> = {}) => ({
  webpage_url: scUrl("artist/full"),
  duration: 200,
  ...over,
});

describe("pickPlayableSoundcloudUrl — filtered selection", () => {
  it("returns the first full, non-DRM, public track", () => {
    const info = { entries: [track({ webpage_url: scUrl("niska/reseaux") })] };
    expect(pickPlayableSoundcloudUrl(info)).toBe(scUrl("niska/reseaux"));
  });

  it("prefers webpage_url over a non-SoundCloud cdn url", () => {
    const info = { entries: [track({ webpage_url: scUrl("a/b"), url: "https://cdn.example/x" })] };
    expect(pickPlayableSoundcloudUrl(info)).toBe(scUrl("a/b"));
  });

  it("skips a ≤40s Go+ preview and picks the next full track", () => {
    const info = {
      entries: [
        track({ duration: SC_MIN_DURATION_SEC, webpage_url: scUrl("prev/30s") }), // 40s → skip
        track({ duration: 205, webpage_url: scUrl("real/song") }),
      ],
    };
    expect(pickPlayableSoundcloudUrl(info)).toBe(scUrl("real/song"));
  });

  it("skips DRM-flagged entries (drm / availability) and picks the next", () => {
    const info = {
      entries: [
        track({ drm: true, webpage_url: scUrl("drm/one") }),
        track({ availability: "premium_only", webpage_url: scUrl("drm/two") }),
        track({ webpage_url: scUrl("clean/three") }),
      ],
    };
    expect(pickPlayableSoundcloudUrl(info)).toBe(scUrl("clean/three"));
  });

  it("skips null entries (yt-dlp --ignore-errors) and picks the next", () => {
    const info = { entries: [null, undefined, track({ webpage_url: scUrl("ok/track") })] };
    expect(pickPlayableSoundcloudUrl(info)).toBe(scUrl("ok/track"));
  });

  it("skips entries without a public soundcloud.com URL", () => {
    const info = {
      entries: [
        { duration: 200, webpage_url: "https://youtube.com/watch?v=x" },
        { duration: 200, url: "ftp://nope" },
        track({ webpage_url: scUrl("valid/one") }),
      ],
    };
    expect(pickPlayableSoundcloudUrl(info)).toBe(scUrl("valid/one"));
  });

  it("only scans the first SC_SEARCH_RESULTS entries", () => {
    const bad = Array.from({ length: SC_SEARCH_RESULTS }, (_, i) => track({ duration: 10, webpage_url: scUrl(`p/${i}`) }));
    const good = track({ webpage_url: scUrl("too/late") }); // 6th → out of window
    expect(() => pickPlayableSoundcloudUrl({ entries: [...bad, good] })).toThrow(UserError);
  });

  it("throws the 'complet et lisible' message when nothing qualifies", () => {
    const info = { entries: [track({ duration: 5 }), track({ drm: true })] };
    expect(() => pickPlayableSoundcloudUrl(info)).toThrow(/complet et lisible/i);
  });

  it("throws on empty / invalid shapes", () => {
    expect(() => pickPlayableSoundcloudUrl({ entries: [] })).toThrow(UserError);
    expect(() => pickPlayableSoundcloudUrl({ foo: "bar" })).toThrow(UserError);
    expect(() => pickPlayableSoundcloudUrl(null)).toThrow(UserError);
  });

  it("keeps entries whose duration is unknown (benefit of the doubt)", () => {
    const info = { entries: [{ webpage_url: scUrl("unknown/dur") }] };
    expect(pickPlayableSoundcloudUrl(info)).toBe(scUrl("unknown/dur"));
  });
});

describe("resolveSoundcloudSearch — bounded pre-resolution", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("queries scsearch5: and resolves to the first playable track URL", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ entries: [track({ webpage_url: scUrl("niska/reseaux") })] });
    await expect(resolveSoundcloudSearch("niska reseaux", fetchJson)).resolves.toBe(scUrl("niska/reseaux"));
    expect(fetchJson).toHaveBeenCalledWith("scsearch5:niska reseaux");
  });

  it("throws 'complet et lisible' when every result is a preview/DRM", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ entries: [track({ duration: 30 }), track({ drm: true })] });
    await expect(resolveSoundcloudSearch("x", fetchJson)).rejects.toThrow(/complet et lisible/i);
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
