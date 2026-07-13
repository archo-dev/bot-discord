import { describe, expect, it } from "vitest";
import { buildGatewayRuntimeSnapshot } from "../src/health.js";

describe("gateway health snapshot", () => {
  it("contains only bounded aggregate runtime fields", () => {
    const snapshot = buildGatewayRuntimeSnapshot({
      version: " 1.2.3 ", uptimeSeconds: -4, memoryRssBytes: 128 * 1024 * 1024,
      voiceLogQueueDepth: 12, channelActivityQueueDepth: 7, errorsSinceLastHeartbeat: 2,
    });
    expect(snapshot).toEqual({
      version: "1.2.3", uptimeSeconds: 0, memoryRssMb: 128,
      voiceLogQueueDepth: 12, channelActivityQueueDepth: 7, errorsSinceLastHeartbeat: 2,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/guild|user|channelId|token|message/i);
  });

  it("caps untrusted counters and version length", () => {
    const snapshot = buildGatewayRuntimeSnapshot({
      version: "x".repeat(100), uptimeSeconds: Number.POSITIVE_INFINITY,
      memoryRssBytes: Number.POSITIVE_INFINITY, voiceLogQueueDepth: 999_999,
      channelActivityQueueDepth: 999_999, errorsSinceLastHeartbeat: 9_999_999,
    });
    expect(snapshot.version).toHaveLength(40);
    expect(snapshot.voiceLogQueueDepth).toBe(100_000);
    expect(snapshot.channelActivityQueueDepth).toBe(100_000);
    expect(snapshot.errorsSinceLastHeartbeat).toBe(1_000_000);
  });
});
