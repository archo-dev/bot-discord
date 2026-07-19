import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SC_MIN_DURATION_SEC,
  SC_SEARCH_RESULTS,
  SC_SEARCH_TIMEOUT_MS,
  UserError,
  normalizeSoundcloudText,
  pickPlayableSoundcloudUrl,
  resolveSoundcloudSearch,
} from "../src/music/format.js";

const scUrl = (slug: string) => `https://soundcloud.com/${slug}`;
const track = (over: Record<string, unknown> = {}) => ({
  webpage_url: scUrl("artist/full"),
  title: "Full",
  uploader: "Artist",
  uploader_id: "artist",
  duration: 200,
  ...over,
});

describe("pickPlayableSoundcloudUrl — filtered selection", () => {
  it("normalizes case, accents, punctuation and whitespace", () => {
    expect(normalizeSoundcloudText("  NÍSKA — Réseaux!!!  ")).toBe("niska reseaux");
  });

  it("returns the first full, non-DRM, public track", () => {
    const info = { entries: [track({ webpage_url: scUrl("niska/reseaux") })] };
    expect(pickPlayableSoundcloudUrl(info, "artist full")).toBe(scUrl("niska/reseaux"));
  });

  it("prefers webpage_url over a non-SoundCloud cdn url", () => {
    const info = { entries: [track({ webpage_url: scUrl("a/b"), url: "https://cdn.example/x" })] };
    expect(pickPlayableSoundcloudUrl(info, "artist full")).toBe(scUrl("a/b"));
  });

  it("prefers the original track to an unrequested remix", () => {
    const info = {
      entries: [
        track({ title: "Réseaux Remix", uploader: "Niska", webpage_url: scUrl("dj/reseaux-remix") }),
        track({ title: "Réseaux", uploader: "Niska", webpage_url: scUrl("niska/reseaux") }),
      ],
    };
    expect(pickPlayableSoundcloudUrl(info, "Niska Réseaux")).toBe(scUrl("niska/reseaux"));
  });

  it("prefers the original track to an unrequested sped up version", () => {
    const info = {
      entries: [
        track({ title: "Réseaux (Sped Up)", uploader: "Niska", webpage_url: scUrl("fan/reseaux-sped-up") }),
        track({ title: "Réseaux", uploader: "Niska", webpage_url: scUrl("niska/reseaux") }),
      ],
    };
    expect(pickPlayableSoundcloudUrl(info, "niska reseaux")).toBe(scUrl("niska/reseaux"));
  });

  it("accepts a remix when the user explicitly requests it", () => {
    const info = {
      entries: [track({ title: "Réseaux Remix", uploader: "Niska", webpage_url: scUrl("dj/reseaux-remix") })],
    };
    expect(pickPlayableSoundcloudUrl(info, "Niska Réseaux remix")).toBe(scUrl("dj/reseaux-remix"));
  });

  it("refuses an unrelated result with the conservative message", () => {
    const info = {
      entries: [track({ title: "Jefe", uploader: "Ninho", webpage_url: scUrl("ninho/jefe") })],
    };
    expect(() => pickPlayableSoundcloudUrl(info, "Niska Réseaux")).toThrow(
      "⚠️ Aucun morceau complet correspondant précisément à votre recherche n'a été trouvé.",
    );
  });

  it("skips a ≤40s Go+ preview and picks the next full track", () => {
    const info = {
      entries: [
        track({ duration: SC_MIN_DURATION_SEC, webpage_url: scUrl("prev/30s") }), // 40s → skip
        track({ duration: 205, webpage_url: scUrl("real/song") }),
      ],
    };
    expect(pickPlayableSoundcloudUrl(info, "artist full")).toBe(scUrl("real/song"));
  });

  it("skips DRM-flagged entries (drm / availability) and picks the next", () => {
    const info = {
      entries: [
        track({ drm: true, webpage_url: scUrl("drm/one") }),
        track({ availability: "premium_only", webpage_url: scUrl("drm/two") }),
        track({ webpage_url: scUrl("clean/three") }),
      ],
    };
    expect(pickPlayableSoundcloudUrl(info, "artist full")).toBe(scUrl("clean/three"));
  });

  it("skips null entries (yt-dlp --ignore-errors) and picks the next", () => {
    const info = { entries: [null, undefined, track({ webpage_url: scUrl("ok/track") })] };
    expect(pickPlayableSoundcloudUrl(info, "artist full")).toBe(scUrl("ok/track"));
  });

  it("skips entries without a public soundcloud.com URL", () => {
    const info = {
      entries: [
        { duration: 200, webpage_url: "https://youtube.com/watch?v=x" },
        { duration: 200, url: "ftp://nope" },
        track({ webpage_url: scUrl("valid/one") }),
      ],
    };
    expect(pickPlayableSoundcloudUrl(info, "artist full")).toBe(scUrl("valid/one"));
  });

  it("only scans the first SC_SEARCH_RESULTS entries", () => {
    const bad = Array.from({ length: SC_SEARCH_RESULTS }, (_, i) => track({ duration: 10, webpage_url: scUrl(`p/${i}`) }));
    const good = track({ webpage_url: scUrl("too/late") }); // 6th → out of window
    expect(() => pickPlayableSoundcloudUrl({ entries: [...bad, good] }, "artist full")).toThrow(UserError);
  });

  it("throws the 'complet et lisible' message when nothing qualifies", () => {
    const info = { entries: [track({ duration: 5 }), track({ drm: true })] };
    expect(() => pickPlayableSoundcloudUrl(info, "artist full")).toThrow(/complet et lisible/i);
  });

  it("throws on empty / invalid shapes", () => {
    expect(() => pickPlayableSoundcloudUrl({ entries: [] }, "artist full")).toThrow(UserError);
    expect(() => pickPlayableSoundcloudUrl({ foo: "bar" }, "artist full")).toThrow(UserError);
    expect(() => pickPlayableSoundcloudUrl(null, "artist full")).toThrow(UserError);
  });

  it("keeps entries whose duration is unknown (benefit of the doubt)", () => {
    const info = { entries: [{ title: "Full", uploader: "Artist", webpage_url: scUrl("unknown/dur") }] };
    expect(pickPlayableSoundcloudUrl(info, "artist full")).toBe(scUrl("unknown/dur"));
  });
});

describe("resolveSoundcloudSearch — bounded pre-resolution", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("queries scsearch5: and resolves to the first playable track URL", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchJson = vi.fn().mockResolvedValue({
      entries: [track({ title: "Réseaux", uploader: "Niska", webpage_url: scUrl("niska/reseaux") })],
    });
    await expect(resolveSoundcloudSearch("niska reseaux", fetchJson)).resolves.toBe(scUrl("niska/reseaux"));
    expect(fetchJson).toHaveBeenCalledWith("scsearch5:niska reseaux");
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it("logs one structured relevance decision with every received entry", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchJson = vi.fn().mockResolvedValue({
      entries: [
        null,
        track({ title: "Réseaux", uploader: "Niska", drm: true, webpage_url: scUrl("drm/reseaux") }),
        track({ title: "Réseaux", uploader: "Niska", duration: 30, webpage_url: scUrl("preview/reseaux") }),
        track({ title: "Réseaux Remix", uploader: "Niska", webpage_url: scUrl("remix/reseaux") }),
        track({ title: "Réseaux", uploader: "Niska", webpage_url: scUrl("niska/reseaux") }),
      ],
    });

    await expect(resolveSoundcloudSearch("  NÍSKA — Réseaux  ", fetchJson)).resolves.toBe(scUrl("niska/reseaux"));

    const payload = JSON.parse(String(logSpy.mock.calls[0]![0])) as {
      event: string;
      query: string;
      entriesReceived: number;
      entries: Array<{ index: number; score: number | null; decision: string; reasons: string[] }>;
      selected: { index: number; title: string; uploader: string };
      selectedScore: number;
      threshold: number;
      rankingMs: number;
    };
    expect(payload).toMatchObject({
      event: "soundcloud_search_relevance",
      query: "niska reseaux",
      entriesReceived: 5,
      selected: { index: 4, title: "Réseaux", uploader: "Niska" },
      threshold: 180,
    });
    expect(payload.entries).toHaveLength(5);
    expect(payload.entries[0]).toMatchObject({ index: 0, decision: "rejected", reasons: ["invalid_url"] });
    expect(payload.entries[1]!.reasons).toContain("drm");
    expect(payload.entries[2]!.reasons).toContain("preview");
    expect(payload.entries[3]!.reasons).toContain("unwanted_variant");
    expect(payload.entries[4]).toMatchObject({ index: 4, decision: "accepted", reasons: [] });
    expect(payload.selectedScore).toBeGreaterThanOrEqual(payload.threshold);
    expect(payload.rankingMs).toBeGreaterThanOrEqual(0);
  });

  it("logs an explicit structured event when relevance returns a UserError", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchJson = vi.fn().mockResolvedValue({
      entries: [track({ title: "Jefe", uploader: "Ninho", webpage_url: scUrl("ninho/jefe") })],
    });

    await expect(resolveSoundcloudSearch("niska reseaux", fetchJson)).rejects.toThrow(/précisément/i);

    const events = logSpy.mock.calls.map(([line]) => JSON.parse(String(line)) as { event: string });
    expect(events.map((event) => event.event)).toEqual([
      "soundcloud_search_relevance",
      "soundcloud_search_relevance_user_error",
    ]);
  });

  it("never logs a full URL, signature, token or cookie value", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchJson = vi.fn().mockResolvedValue({
      entries: [
        track({
          title: "Réseaux https://media.example/private/audio?sig=SIGNATURE_SECRET",
          uploader: "Niska Cookie: COOKIE_SECRET",
          webpage_url: scUrl("niska/reseaux"),
        }),
      ],
    });

    await expect(resolveSoundcloudSearch("niska reseaux token=TOKEN_SECRET", fetchJson)).rejects.toThrow(UserError);

    const logged = logSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).not.toContain("https://media.example/private/audio");
    expect(logged).not.toContain("SIGNATURE_SECRET");
    expect(logged).not.toContain("COOKIE_SECRET");
    expect(logged).not.toContain("TOKEN_SECRET");
    expect(logged).not.toMatch(/sig=/i);
  });

  it("throws 'complet et lisible' when every result is a preview/DRM", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ entries: [track({ duration: 30 }), track({ drm: true })] });
    await expect(resolveSoundcloudSearch("artist full", fetchJson)).rejects.toThrow(/complet et lisible/i);
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
