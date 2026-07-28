import { describe, expect, it } from "vitest";
import type { StorageLike } from "../src/lib/resilience.js";
import {
  formatVoiceDuration,
  readVoiceDurationUnit,
  VOICE_DURATION_UNIT_KEY,
  writeVoiceDurationUnit,
} from "../src/lib/voice-duration.js";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("voice duration formatting", () => {
  const longDuration = 6_862 * 60 + 31;

  it("keeps seconds visible for short, zero and 91-minute durations", () => {
    expect(formatVoiceDuration(26, "auto")).toBe("0 min 26 s");
    expect(formatVoiceDuration(0, "auto")).toBe("0 min 0 s");
    expect(formatVoiceDuration(91 * 60 + 31, "auto")).toBe("1 h 31 min 31 s");
  });

  it("formats 6 862 min 31 s in every requested unit", () => {
    expect(formatVoiceDuration(longDuration, "auto")).toBe("4 j 18 h 22 min 31 s");
    expect(formatVoiceDuration(longDuration, "minutes")).toBe("6 862 min 31 s");
    expect(formatVoiceDuration(longDuration, "hours")).toBe("114 h 22 min 31 s");
    expect(formatVoiceDuration(longDuration, "days")).toBe("4 j 18 h 22 min 31 s");
  });

  it("switches Auto at the hour and day boundaries", () => {
    expect(formatVoiceDuration(3_599, "auto")).toBe("59 min 59 s");
    expect(formatVoiceDuration(3_600, "auto")).toBe("1 h 0 min 0 s");
    expect(formatVoiceDuration(86_399, "auto")).toBe("23 h 59 min 59 s");
    expect(formatVoiceDuration(86_400, "auto")).toBe("1 j 0 h 0 min 0 s");
  });

  it("handles large and incoherent values while preserving second precision", () => {
    expect(formatVoiceDuration(123_456_789, "days")).toBe("1 428 j 21 h 33 min 9 s");
    expect(formatVoiceDuration(Number.NaN, "minutes")).toBe("0 min 0 s");
    expect(formatVoiceDuration(-26, "hours")).toBe("0 h 0 min 0 s");
    expect(formatVoiceDuration(5_461.4, "hours")).toBe("1 h 31 min 1 s");
  });
});

describe("voice duration preference", () => {
  it("defaults to Auto and persists a valid local preference", () => {
    const storage = new MemoryStorage();
    expect(readVoiceDurationUnit(storage)).toBe("auto");
    expect(writeVoiceDurationUnit(storage, "hours")).toBe(true);
    expect(readVoiceDurationUnit(storage)).toBe("hours");
    expect(storage.values.has(VOICE_DURATION_UNIT_KEY)).toBe(true);
  });

  it("rejects and removes an invalid stored preference", () => {
    const storage = new MemoryStorage();
    storage.setItem(VOICE_DURATION_UNIT_KEY, JSON.stringify({ version: 1, value: "weeks" }));
    expect(readVoiceDurationUnit(storage)).toBe("auto");
    expect(storage.getItem(VOICE_DURATION_UNIT_KEY)).toBeNull();
  });
});
