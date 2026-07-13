import { homedir } from "node:os";
import { join } from "node:path";
import {
  RELIABLE_EVENT_TYPES,
  validateReliableEnvelope,
  type ReliableEnvelope,
  type ReliableEventType,
} from "@bot/shared";
import type { GatewayEnv } from "../env.js";
import type { ReliableBatchSendResult } from "../worker-api.js";
import { OutboxStore, type OutboxLimits } from "./store.js";
import { OutboxDispatcher } from "./dispatcher.js";

/*
 * Reliable-delivery facade (M05). Owns the persistent store + dispatcher and
 * decides, per event type, whether a flow is routed through the durable outbox
 * (at-least-once) or left on the direct path. EMPTY GATEWAY_RELIABLE_TYPES = the
 * outbox is never even opened → deploying the gateway is a zero-behavior change.
 * If the store cannot be opened, we fall back to a disabled outbox so the bot
 * never fails to start because of reliability plumbing.
 */

export interface DeliveryMetrics {
  enabled: boolean;
  reliableTypes: string[];
  pending: number;
  dead: number;
  oldestAgeMs: number;
  bytes: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  added: number;
  dropped: number;
  delivered: number;
  duplicates: number;
  retries: number;
  running: boolean;
}

export interface Outbox {
  isReliable(type: ReliableEventType): boolean;
  /** Durable enqueue; returns false when dropped (backpressure/poison/duplicate). */
  enqueue(env: ReliableEnvelope): boolean;
  metrics(): DeliveryMetrics;
  start(): void;
  stop(): Promise<void>;
}

function parseReliableTypes(raw: string | undefined): Set<ReliableEventType> {
  const set = new Set<ReliableEventType>();
  for (const token of (raw ?? "").split(",").map((t) => t.trim()).filter(Boolean)) {
    if ((RELIABLE_EVENT_TYPES as readonly string[]).includes(token)) set.add(token as ReliableEventType);
  }
  return set;
}

/** No-op outbox: reliable delivery disabled or unavailable → callers use direct delivery. */
function disabledOutbox(types: Set<ReliableEventType>): Outbox {
  return {
    isReliable: () => false,
    enqueue: () => false,
    metrics: () => ({
      enabled: false,
      reliableTypes: [...types],
      pending: 0,
      dead: 0,
      oldestAgeMs: 0,
      bytes: 0,
      byType: {},
      byPriority: {},
      added: 0,
      dropped: 0,
      delivered: 0,
      duplicates: 0,
      retries: 0,
      running: false,
    }),
    start: () => {},
    stop: async () => {},
  };
}

export function createOutbox(
  env: GatewayEnv,
  send: (events: ReliableEnvelope[]) => Promise<ReliableBatchSendResult>,
  log: (message: string) => void = console.error,
): Outbox {
  const types = parseReliableTypes(env.GATEWAY_RELIABLE_TYPES);
  if (types.size === 0) return disabledOutbox(types);

  let store: OutboxStore;
  const path = env.GATEWAY_OUTBOX_PATH ?? join(homedir(), ".botdiscord", "outbox.db");
  try {
    store = new OutboxStore(path);
  } catch (err) {
    log(`outbox disabled: cannot open ${path}: ${err instanceof Error ? err.message : "unknown"}`);
    return disabledOutbox(types);
  }

  const limits: OutboxLimits = { maxEvents: env.GATEWAY_OUTBOX_MAX_EVENTS, maxBytes: env.GATEWAY_OUTBOX_MAX_BYTES };
  const dispatcher = new OutboxDispatcher({
    store,
    send,
    maxAttempts: env.GATEWAY_OUTBOX_MAX_ATTEMPTS,
    concurrency: env.GATEWAY_OUTBOX_CONCURRENCY,
    maxAgeMs: env.GATEWAY_OUTBOX_MAX_AGE_MS,
    maxDead: env.GATEWAY_OUTBOX_MAX_DEAD,
    onLog: log,
  });

  let added = 0;
  let dropped = 0;

  return {
    isReliable: (type) => types.has(type),
    enqueue(envelope) {
      // Never let a poison envelope reach the durable store.
      const validated = validateReliableEnvelope(envelope);
      if (!validated.ok) {
        dropped++;
        log(`outbox rejected invalid envelope (${validated.code})`);
        return false;
      }
      let result: ReturnType<OutboxStore["enqueue"]>;
      try {
        result = store.enqueue(validated.envelope, limits);
      } catch (err) {
        // Disk full / IO error: drop (backpressure), keep the bot running.
        dropped++;
        log(`outbox enqueue failed: ${err instanceof Error ? err.message : "unknown"}`);
        return false;
      }
      if (result === "enqueued") {
        added++;
        return true;
      }
      if (result === "dropped") dropped++;
      return false; // duplicate or dropped
    },
    metrics() {
      const m = store.metrics();
      const c = dispatcher.counters;
      return {
        enabled: true,
        reliableTypes: [...types],
        pending: m.pending,
        dead: m.dead,
        oldestAgeMs: m.oldestAgeMs,
        bytes: m.bytes,
        byType: m.byType,
        byPriority: m.byPriority,
        added,
        dropped,
        delivered: c.delivered,
        duplicates: c.duplicates,
        retries: c.retries,
        running: dispatcher.isRunning,
      };
    },
    start: () => dispatcher.start(),
    stop: () => dispatcher.stop(),
  };
}
