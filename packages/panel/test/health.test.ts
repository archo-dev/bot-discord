import { describe, expect, it } from "vitest";
import { formatP95, formatSuccessRate, healthStateMeta } from "../src/lib/health.js";

describe("health presentation", () => {
  it("has a readable presentation for every API state", () => {
    expect(Object.keys(healthStateMeta).sort()).toEqual(["degraded", "inactive", "operational", "unavailable"]);
    for (const meta of Object.values(healthStateMeta)) {
      expect(meta.label.length).toBeGreaterThan(3);
      expect(meta.dot).toMatch(/^bg-/);
    }
  });

  it("formats sampled rates and approximate latency without false precision", () => {
    expect(formatSuccessRate(0.991)).toBe("99.1 %");
    expect(formatSuccessRate(null)).toBe("—");
    expect(formatP95(1000)).toMatch(/1.*000 ms/);
    expect(formatP95(null)).toBe("—");
  });
});
