import { describe, expect, it } from "vitest";
import { clampSeekPosition, reconcileSeekDraft, rollbackSeekDraft } from "../src/lib/music-seek.js";

describe("interactive music seek state", () => {
  it("clamps click, keyboard and end positions to the known duration", () => {
    expect(clampSeekPosition(0, 180)).toBe(0);
    expect(clampSeekPosition(180, 180)).toBe(180);
    expect(clampSeekPosition(-2, 180)).toBe(0);
    expect(clampSeekPosition(181, 180)).toBe(180);
  });

  it("does not move an active drag when a server snapshot arrives", () => {
    expect(reconcileSeekDraft(90, 12, 180, true)).toBe(90);
    expect(reconcileSeekDraft(90, 12, 180, false)).toBe(12);
  });

  it("rolls an optimistic position back to the authoritative snapshot", () => {
    expect(rollbackSeekDraft(24, 180)).toBe(24);
    expect(rollbackSeekDraft(999, 180)).toBe(180);
  });
});
