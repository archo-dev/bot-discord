import type { GatewayHeartbeatRuntime } from "@bot/shared";

export interface GatewayRuntimeSnapshotInput {
  version: string | undefined;
  uptimeSeconds: number;
  memoryRssBytes: number;
  voiceLogQueueDepth: number;
  channelActivityQueueDepth: number;
  errorsSinceLastHeartbeat: number;
}

const boundedInt = (value: number, max: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : max;

/** Pure, bounded heartbeat payload builder (no user, guild or channel data). */
export function buildGatewayRuntimeSnapshot(input: GatewayRuntimeSnapshotInput): GatewayHeartbeatRuntime {
  return {
    version: (input.version?.trim() || "unknown").slice(0, 40),
    uptimeSeconds: boundedInt(input.uptimeSeconds, 31_536_000),
    memoryRssMb: boundedInt(input.memoryRssBytes / 1024 / 1024, 1_048_576),
    voiceLogQueueDepth: boundedInt(input.voiceLogQueueDepth, 100_000),
    channelActivityQueueDepth: boundedInt(input.channelActivityQueueDepth, 100_000),
    errorsSinceLastHeartbeat: boundedInt(input.errorsSinceLastHeartbeat, 1_000_000),
  };
}
