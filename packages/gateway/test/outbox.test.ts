import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RELIABLE_DELIVERY_SCHEMA_VERSION,
  reliablePartitionKey,
  type ReliableEnvelope,
  type ReliableEventType,
} from "@bot/shared";
import { OutboxStore } from "../src/outbox/store.js";
import { OutboxDispatcher } from "../src/outbox/dispatcher.js";
import type { ReliableBatchSendResult } from "../src/worker-api.js";

const dirs: string[] = [];
const stores: OutboxStore[] = [];
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "outbox-"));
  dirs.push(dir);
  return join(dir, "outbox.db");
}
/** Track every store so afterEach can close it before deleting the file (Windows locks open DBs). */
function open(path: string): OutboxStore {
  const store = new OutboxStore(path);
  stores.push(store);
  return store;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

let seq = 0;
function ev(guildId = "100000000000000001", type: ReliableEventType = "voice_log", priority: 0 | 1 = 0): ReliableEnvelope {
  return {
    schemaVersion: RELIABLE_DELIVERY_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    type,
    guildId,
    partitionKey: reliablePartitionKey(guildId),
    priority,
    occurredAt: Date.now() + seq++,
    payload: { userId: "111111111111111111", userTag: null, action: "join", channelId: "222222222222222222", fromChannelId: null },
  } as ReliableEnvelope;
}

const LIMITS = { maxEvents: 20_000, maxBytes: 64 * 1024 * 1024 };

describe("OutboxStore", () => {
  it("enqueues durably and dedups by eventId", () => {
    const store = open(tempDb());
    const e = ev();
    expect(store.enqueue(e, LIMITS)).toBe("enqueued");
    expect(store.enqueue(e, LIMITS)).toBe("duplicate");
    expect(store.pendingCount()).toBe(1);
    store.close();
  });

  it("survives a process crash (reopen the same file → events still pending)", () => {
    const path = tempDb();
    const s1 = open(path);
    s1.enqueue(ev(), LIMITS);
    s1.enqueue(ev(), LIMITS);
    s1.close(); // simulate crash/restart without draining

    const s2 = open(path);
    expect(s2.pendingCount()).toBe(2);
    s2.close();
  });

  it("applies priority-aware backpressure at capacity", () => {
    const store = open(tempDb());
    const tiny = { maxEvents: 2, maxBytes: 64 * 1024 * 1024 };
    expect(store.enqueue(ev("1", "channel_activity", 1), tiny)).toBe("enqueued"); // low
    expect(store.enqueue(ev("1", "channel_activity", 1), tiny)).toBe("enqueued"); // low, now full
    expect(store.enqueue(ev("1", "channel_activity", 1), tiny)).toBe("dropped"); // low rejected
    expect(store.enqueue(ev("1", "voice_log", 0), tiny)).toBe("enqueued"); // normal evicts a low one
    expect(store.pendingCount()).toBe(2);
    store.close();
  });

  it("reaps events older than max age into dead-letter", () => {
    const store = open(tempDb());
    store.enqueue(ev(), LIMITS);
    const reaped = store.reapExpired(-1, Date.now()); // everything is "too old"
    expect(reaped).toBe(1);
    expect(store.pendingCount()).toBe(0);
    expect(store.metrics().dead).toBe(1);
    store.close();
  });

  it("bounds the dead-letter to the most recent N (older ones purged)", () => {
    const store = open(tempDb());
    for (let i = 0; i < 10; i++) store.enqueue(ev(), LIMITS);
    store.reapExpired(-1, Date.now()); // dead-letter all 10
    expect(store.metrics().dead).toBe(10);
    const purged = store.purgeDeadLetter(3); // keep only the 3 most recent
    expect(purged).toBe(7);
    expect(store.metrics().dead).toBe(3);
    store.close();
  });
});

// Deterministic dispatcher harness.
function harness(store: OutboxStore, send: (events: ReliableEnvelope[]) => Promise<ReliableBatchSendResult>, over: Partial<ConstructorParameters<typeof OutboxDispatcher>[0]> = {}) {
  let clock = Date.now() + 1000;
  const d = new OutboxDispatcher({
    store,
    send,
    maxAttempts: 5,
    concurrency: 4,
    maxAgeMs: 24 * 3600 * 1000,
    baseBackoffMs: 1000,
    now: () => clock,
    random: () => 0,
    ...over,
  });
  return { d, advance: (ms: number) => (clock += ms), get clock() { return clock; } };
}

const okAll = (events: ReliableEnvelope[]): Promise<ReliableBatchSendResult> =>
  Promise.resolve({ kind: "ok", results: events.map((e) => ({ eventId: e.eventId, status: "accepted" as const })) });

describe("OutboxDispatcher", () => {
  it("delivers a batch and removes acked events", async () => {
    const store = open(tempDb());
    store.enqueue(ev(), LIMITS);
    store.enqueue(ev(), LIMITS);
    const { d } = harness(store, okAll);
    expect(await d.runOnce()).toBe(true);
    expect(store.pendingCount()).toBe(0);
    expect(d.counters.delivered).toBe(2);
  });

  it("treats duplicate/skipped acks as terminal (removed, not retried)", async () => {
    const store = open(tempDb());
    const a = ev(), b = ev();
    store.enqueue(a, LIMITS);
    store.enqueue(b, LIMITS);
    const send = async (events: ReliableEnvelope[]): Promise<ReliableBatchSendResult> => ({
      kind: "ok",
      results: events.map((e) => ({ eventId: e.eventId, status: e.eventId === a.eventId ? "duplicate" : "skipped" })),
    });
    const { d } = harness(store, send);
    await d.runOnce();
    expect(store.pendingCount()).toBe(0);
    expect(d.counters.duplicates).toBe(1);
    expect(d.counters.skipped).toBe(1);
  });

  it("retries transient failures with backoff, then dead-letters after max attempts", async () => {
    const store = open(tempDb());
    store.enqueue(ev(), LIMITS);
    const send = async (): Promise<ReliableBatchSendResult> => ({ kind: "transient" });
    const h = harness(store, send, { maxAttempts: 3, baseBackoffMs: 1000 });
    await h.d.runOnce(); // attempt 1 → reschedule +1000
    expect(store.pendingCount()).toBe(1);
    h.advance(2000);
    await h.d.runOnce(); // attempt 2 → reschedule +2000
    expect(store.pendingCount()).toBe(1);
    h.advance(4000);
    await h.d.runOnce(); // attempt 3 → max reached → dead
    expect(store.pendingCount()).toBe(0);
    expect(store.metrics().dead).toBe(1);
  });

  it("survives a 10-minute Worker outage without losing events", async () => {
    const store = open(tempDb());
    store.enqueue(ev(), LIMITS);
    store.enqueue(ev(), LIMITS);
    const send = async (): Promise<ReliableBatchSendResult> => ({ kind: "transient" });
    const h = harness(store, send, { maxAttempts: 100, baseBackoffMs: 1000 });
    for (let i = 0; i < 20; i++) {
      await h.d.runOnce();
      h.advance(60_000); // 20 minutes of outage across ticks
    }
    // Nothing lost, nothing dead (attempts < max): still pending, ready to drain.
    expect(store.pendingCount()).toBe(2);
    expect(store.metrics().dead).toBe(0);
    // Worker recovers → once the backoff elapses, the next drain delivers everything.
    const ok = harness(store, okAll, { now: () => h.clock + 10_000_000 });
    await ok.d.runOnce();
    expect(store.pendingCount()).toBe(0);
  });

  it("honours Retry-After for the reschedule delay", async () => {
    const store = open(tempDb());
    const e = ev();
    store.enqueue(e, LIMITS);
    const send = async (): Promise<ReliableBatchSendResult> => ({ kind: "transient", retryAfterMs: 30_000 });
    const h = harness(store, send);
    await h.d.runOnce();
    h.advance(5_000);
    await h.d.runOnce(); // not due yet (retry-after 30 s)
    expect(store.metrics().pending).toBe(1);
    const row = store.claimBatch(h.clock + 40_000, e.partitionKey, 10);
    expect(row).toHaveLength(1);
    expect(row[0]!.attempts).toBe(1); // only one attempt so far
  });

  it("dead-letters a permanent 400 (reject) batch", async () => {
    const store = open(tempDb());
    store.enqueue(ev(), LIMITS);
    const { d } = harness(store, async () => ({ kind: "reject" }));
    await d.runOnce();
    expect(store.pendingCount()).toBe(0);
    expect(store.metrics().dead).toBe(1);
  });

  it("dead-letters a per-event invalid ack (poison), keeps others", async () => {
    const store = open(tempDb());
    const bad = ev(), good = ev();
    store.enqueue(bad, LIMITS);
    store.enqueue(good, LIMITS);
    const send = async (events: ReliableEnvelope[]): Promise<ReliableBatchSendResult> => ({
      kind: "ok",
      results: events.map((e) => ({ eventId: e.eventId, status: e.eventId === bad.eventId ? "invalid" : "accepted" })),
    });
    const { d } = harness(store, send);
    await d.runOnce();
    expect(store.metrics().dead).toBe(1);
    expect(d.counters.delivered).toBe(1);
    expect(store.pendingCount()).toBe(0);
  });

  it("dead-letters a corrupt on-disk row (poison payload) without crashing", async () => {
    const path = tempDb();
    const store = open(path);
    store.enqueue(ev(), LIMITS);
    store.close();
    // Corrupt the payload column directly.
    const raw = open(path);
    (raw as unknown as { db: { exec(sql: string): void } }).db.exec("UPDATE outbox SET payload = '{not json' WHERE 1=1");
    const { d } = harness(raw, okAll);
    await d.runOnce();
    expect(raw.pendingCount()).toBe(0);
    expect(raw.metrics().dead).toBe(1);
    raw.close();
  });

  it("keeps at most one batch per partition but parallelises across partitions", async () => {
    const store = open(tempDb());
    // Two partitions (guilds), two events each.
    for (const g of ["1", "2"]) {
      store.enqueue(ev(g), LIMITS);
      store.enqueue(ev(g), LIMITS);
    }
    const seen: Array<Set<string>> = [];
    const send = async (events: ReliableEnvelope[]): Promise<ReliableBatchSendResult> => {
      seen.push(new Set(events.map((e) => e.partitionKey)));
      return okAll(events);
    };
    const { d } = harness(store, send, { concurrency: 4 });
    await d.runOnce();
    // Each send call touches exactly one partition (ordering guarantee).
    for (const s of seen) expect(s.size).toBe(1);
    // Both partitions were drained.
    expect(store.pendingCount()).toBe(0);
    expect(new Set([...seen].flatMap((s) => [...s])).size).toBe(2);
  });

  it("re-delivers safely after a crash between ack and local delete (dedup)", async () => {
    const path = tempDb();
    const store = open(path);
    const e = ev();
    store.enqueue(e, LIMITS);
    // The Worker applied the event (accepted) but the gateway crashed before
    // store.ack → the row survives the restart.
    store.close();
    const reopened = open(path);
    expect(reopened.pendingCount()).toBe(1);
    // On retry the Worker now dedups it (already processed) → terminal → removed.
    const dupSend = async (events: ReliableEnvelope[]): Promise<ReliableBatchSendResult> => ({
      kind: "ok",
      results: events.map((x) => ({ eventId: x.eventId, status: "duplicate" })),
    });
    const { d } = harness(reopened, dupSend);
    await d.runOnce();
    expect(reopened.pendingCount()).toBe(0);
    expect(d.counters.duplicates).toBe(1);
  });

  it("persists only bounded envelope fields — no secret, token or auth header", () => {
    const store = open(tempDb());
    const e = ev();
    store.enqueue(e, LIMITS);
    const rows = store.claimBatch(Date.now() + 1_000, e.partitionKey, 10);
    const parsed = JSON.parse(rows[0]!.payload) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "eventId",
      "guildId",
      "occurredAt",
      "partitionKey",
      "payload",
      "priority",
      "schemaVersion",
      "type",
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(/token|secret|authorization|cookie|bearer/i);
    store.close();
  });

  it("stops gracefully leaving undelivered events persisted", async () => {
    const path = tempDb();
    const store = open(path);
    store.enqueue(ev(), LIMITS);
    const { d } = harness(store, async () => ({ kind: "transient" }));
    await d.runOnce();
    await d.stop(); // closes the store
    const reopened = open(path);
    expect(reopened.pendingCount()).toBe(1); // preserved for next boot
    reopened.close();
  });
});
