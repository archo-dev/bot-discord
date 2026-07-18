import { describe, expect, it, vi } from "vitest";
import { UserError, normalizeQuery, withTimeout, PLAY_TIMEOUT_MS } from "../src/music/format.js";

describe("normalizeQuery — YouTube URL cleaning", () => {
  it("keeps a plain watch?v=<id> URL as the bare video", () => {
    expect(normalizeQuery("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("strips a Mix/Radio (list=RD…&start_radio=1) down to the video — the /play hang", () => {
    expect(
      normalizeQuery("https://www.youtube.com/watch?v=4AUExg0Pjlg&list=RD4AUExg0Pjlg&start_radio=1"),
    ).toBe("https://www.youtube.com/watch?v=4AUExg0Pjlg");
  });

  it("drops every playlist param: list, start_radio, index, pp, si, t", () => {
    const cleaned = normalizeQuery(
      "https://www.youtube.com/watch?v=abc123DEF45&list=PLxxxx&start_radio=1&index=7&pp=ygU_&si=zZz&t=42",
    );
    expect(cleaned).toBe("https://www.youtube.com/watch?v=abc123DEF45");
    for (const p of ["list", "start_radio", "index", "pp", "si", "t"]) {
      expect(cleaned).not.toContain(`${p}=`);
    }
  });

  it("converts youtu.be/<id> (with tracking params) to a watch URL", () => {
    expect(normalizeQuery("https://youtu.be/dQw4w9WgXcQ?si=abcd&t=30")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("converts a youtube.com/shorts/<id> URL to a watch URL", () => {
    expect(normalizeQuery("https://www.youtube.com/shorts/AbCdEfGhIjk")).toBe(
      "https://www.youtube.com/watch?v=AbCdEfGhIjk",
    );
  });

  it("normalizes m. and music. hosts too", () => {
    expect(normalizeQuery("https://m.youtube.com/watch?v=zzz111YYY22&list=RDzzz")).toBe(
      "https://www.youtube.com/watch?v=zzz111YYY22",
    );
    expect(normalizeQuery("https://music.youtube.com/watch?v=Www222Xxx33")).toBe(
      "https://www.youtube.com/watch?v=Www222Xxx33",
    );
  });

  it("rejects a bare playlist URL with a UserError", () => {
    expect(() => normalizeQuery("https://www.youtube.com/playlist?list=PLabcdef")).toThrow(UserError);
    expect(() => normalizeQuery("https://www.youtube.com/playlist?list=PLabcdef")).toThrow(
      /playlists YouTube complètes/i,
    );
  });

  it("rejects a watch URL that carries a list but no video id", () => {
    expect(() => normalizeQuery("https://www.youtube.com/watch?list=PLabcdef")).toThrow(UserError);
  });

  it("leaves a Spotify URL unchanged", () => {
    const spotify = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";
    expect(normalizeQuery(spotify)).toBe(spotify);
  });

  it("leaves a plain text search unchanged", () => {
    expect(normalizeQuery("  niska reseaux  ")).toBe("niska reseaux");
  });
});

describe("withTimeout — bounded extraction", () => {
  it("resolves with the value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, () => new Error("nope"))).resolves.toBe("ok");
  });

  it("rejects with the provided error and never leaves the promise pending", async () => {
    vi.useFakeTimers();
    // A promise that never resolves — simulates a stuck distube.play().
    const stuck = new Promise<string>(() => {});
    const raced = withTimeout(stuck, PLAY_TIMEOUT_MS, () => new UserError("⏱️ timeout"));
    const assertion = expect(raced).rejects.toThrowError(UserError);
    await vi.advanceTimersByTimeAsync(PLAY_TIMEOUT_MS + 1);
    await assertion;
    vi.useRealTimers();
  });
});
