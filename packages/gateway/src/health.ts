import type { GatewayDeliveryRuntime, GatewayHeartbeatRuntime } from "@bot/shared";
import type { DeliveryMetrics } from "./outbox/index.js";

export interface GatewayRuntimeSnapshotInput {
  version: string | undefined;
  uptimeSeconds: number;
  memoryRssBytes: number;
  voiceLogQueueDepth: number;
  channelActivityQueueDepth: number;
  errorsSinceLastHeartbeat: number;
  delivery?: DeliveryMetrics;
}

const boundedInt = (value: number, max: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : max;

const MAX_COUNT = 1_000_000_000;

/** Bounds a by-key counter map to finite, non-negative ints (cardinality already bounded by finite types). */
function boundedMap(map: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) out[k.slice(0, 40)] = boundedInt(v, MAX_COUNT);
  return out;
}

function buildDelivery(d: DeliveryMetrics): GatewayDeliveryRuntime {
  return {
    enabled: d.enabled,
    running: d.running,
    pending: boundedInt(d.pending, MAX_COUNT),
    dead: boundedInt(d.dead, MAX_COUNT),
    oldestAgeSeconds: boundedInt(d.oldestAgeMs / 1000, 100 * 24 * 3600),
    bytes: boundedInt(d.bytes, 1_000_000_000_000),
    added: boundedInt(d.added, MAX_COUNT),
    dropped: boundedInt(d.dropped, MAX_COUNT),
    delivered: boundedInt(d.delivered, MAX_COUNT),
    duplicates: boundedInt(d.duplicates, MAX_COUNT),
    retries: boundedInt(d.retries, MAX_COUNT),
    byType: boundedMap(d.byType),
    byPriority: boundedMap(d.byPriority),
  };
}

/** Pure, bounded heartbeat payload builder (no user, guild or channel data). */
export function buildGatewayRuntimeSnapshot(input: GatewayRuntimeSnapshotInput): GatewayHeartbeatRuntime {
  return {
    version: (input.version?.trim() || "unknown").slice(0, 40),
    uptimeSeconds: boundedInt(input.uptimeSeconds, 31_536_000),
    memoryRssMb: boundedInt(input.memoryRssBytes / 1024 / 1024, 1_048_576),
    voiceLogQueueDepth: boundedInt(input.voiceLogQueueDepth, 100_000),
    channelActivityQueueDepth: boundedInt(input.channelActivityQueueDepth, 100_000),
    errorsSinceLastHeartbeat: boundedInt(input.errorsSinceLastHeartbeat, 1_000_000),
    ...(input.delivery ? { delivery: buildDelivery(input.delivery) } : {}),
  };
}
