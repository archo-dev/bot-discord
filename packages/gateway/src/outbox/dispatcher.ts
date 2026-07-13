import { ackIsTerminal, type ReliableEnvelope } from "@bot/shared";
import { OutboxStore, type OutboxRow } from "./store.js";
import type { ReliableBatchSendResult } from "../worker-api.js";

/*
 * Outbox dispatcher (M05). Drains the persistent outbox to the Worker:
 * partitioned (one in-flight batch per partition), bounded concurrency,
 * exponential backoff + jitter honouring Retry-After, dead-letter after max
 * attempts or max age, adaptive idle interval (never a tight loop), graceful
 * stop. Decoupled from worker-api via `send` for deterministic tests.
 */

export interface DispatcherOptions {
  store: OutboxStore;
  send: (events: ReliableEnvelope[]) => Promise<ReliableBatchSendResult>;
  maxAttempts: number;
  concurrency: number;
  maxAgeMs: number;
  maxDead?: number;
  batchSize?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  activeIntervalMs?: number;
  idleIntervalMinMs?: number;
  idleIntervalMaxMs?: number;
  now?: () => number;
  random?: () => number;
  onLog?: (message: string) => void;
}

export interface DispatcherCounters {
  delivered: number;
  duplicates: number;
  skipped: number;
  retries: number;
  dead: number;
  batches: number;
}

export class OutboxDispatcher {
  private readonly store: OutboxStore;
  private readonly send: (events: ReliableEnvelope[]) => Promise<ReliableBatchSendResult>;
  private readonly maxAttempts: number;
  private readonly concurrency: number;
  private readonly maxAgeMs: number;
  private readonly maxDead: number;
  private readonly batchSize: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly activeMs: number;
  private readonly idleMin: number;
  private readonly idleMax: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly onLog: (message: string) => void;

  readonly counters: DispatcherCounters = { delivered: 0, duplicates: 0, skipped: 0, retries: 0, dead: 0, batches: 0 };

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<boolean> | null = null;
  private stopped = false;
  private idleDelay: number;

  constructor(opts: DispatcherOptions) {
    this.store = opts.store;
    this.send = opts.send;
    this.maxAttempts = opts.maxAttempts;
    this.concurrency = opts.concurrency;
    this.maxAgeMs = opts.maxAgeMs;
    this.maxDead = opts.maxDead ?? 5_000;
    this.batchSize = opts.batchSize ?? 100;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 300_000;
    this.activeMs = opts.activeIntervalMs ?? 300;
    this.idleMin = opts.idleIntervalMinMs ?? 1_000;
    this.idleMax = opts.idleIntervalMaxMs ?? 15_000;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.onLog = opts.onLog ?? (() => {});
    this.idleDelay = this.idleMin;
  }

  /** Exponential backoff with bounded jitter. attempts is 1-based. */
  backoff(attempts: number): number {
    const exp = this.baseBackoffMs * 2 ** Math.min(attempts - 1, 20);
    return Math.min(exp, this.maxBackoffMs) + Math.floor(this.random() * 250);
  }

  /**
   * One drain pass. Reaps expired events, then processes up to `concurrency`
   * distinct partitions in parallel. Returns true when it did work (so the loop
   * ticks again soon). Exposed for deterministic tests.
   */
  async runOnce(): Promise<boolean> {
    const now = this.now();
    const reaped = this.store.reapExpired(this.maxAgeMs, now);
    if (reaped > 0) this.counters.dead += reaped;
    // Bound the dead-letter so poison/failed events can't grow the file forever.
    this.store.purgeDeadLetter(this.maxDead);

    const partitions = this.store.duePartitions(now, EMPTY, this.concurrency);
    if (partitions.length === 0) return reaped > 0;
    await Promise.all(partitions.map((pk) => this.processPartition(pk, now)));
    return true;
  }

  private async processPartition(partitionKey: string, now: number): Promise<void> {
    const rows = this.store.claimBatch(now, partitionKey, this.batchSize);
    if (rows.length === 0) return;

    const envelopes: ReliableEnvelope[] = [];
    const corrupt: string[] = [];
    for (const row of rows) {
      const env = OutboxStore.parseEnvelope(row);
      if (env) envelopes.push(env);
      else corrupt.push(row.event_id);
    }
    if (corrupt.length > 0) {
      this.store.deadLetter(corrupt);
      this.counters.dead += corrupt.length;
    }
    if (envelopes.length === 0) return;

    this.counters.batches++;
    let result: ReliableBatchSendResult;
    try {
      result = await this.send(envelopes);
    } catch (err) {
      // send must not throw, but be defensive: treat as transient.
      this.onLog(`send threw: ${err instanceof Error ? err.message : "unknown"}`);
      result = { kind: "transient" };
    }

    const liveRows = rows.filter((r) => !corrupt.includes(r.event_id));
    if (result.kind === "reject") {
      this.store.deadLetter(liveRows.map((r) => r.event_id));
      this.counters.dead += liveRows.length;
      return;
    }
    if (result.kind === "transient") {
      for (const row of liveRows) this.rescheduleOrDead(row, result.retryAfterMs, now);
      return;
    }

    const ackById = new Map(result.results.map((a) => [a.eventId, a.status]));
    const toAck: string[] = [];
    const toDead: string[] = [];
    for (const row of liveRows) {
      const status = ackById.get(row.event_id);
      if (status === undefined) {
        // Worker returned no verdict for this id: retry conservatively.
        this.rescheduleOrDead(row, undefined, now);
        continue;
      }
      if (ackIsTerminal(status)) {
        toAck.push(row.event_id);
        if (status === "duplicate") this.counters.duplicates++;
        else if (status === "skipped") this.counters.skipped++;
        else this.counters.delivered++;
      } else if (status === "invalid") {
        toDead.push(row.event_id);
        this.counters.dead++;
      } else {
        this.rescheduleOrDead(row, undefined, now);
      }
    }
    this.store.ack(toAck);
    this.store.deadLetter(toDead);
  }

  private rescheduleOrDead(row: OutboxRow, retryAfterMs: number | undefined, now: number): void {
    const attempts = row.attempts + 1;
    if (attempts >= this.maxAttempts) {
      this.store.deadLetter([row.event_id], attempts);
      this.counters.dead++;
      return;
    }
    const delay = retryAfterMs ?? this.backoff(attempts);
    this.store.reschedule(row.event_id, now + delay, attempts);
    this.counters.retries++;
  }

  // --- lifecycle -------------------------------------------------------------

  start(): void {
    if (this.stopped) return;
    this.schedule(0);
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => void this.loop(), delay);
    this.timer.unref?.();
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    let didWork = false;
    this.running = this.runOnce();
    try {
      didWork = await this.running;
    } catch (err) {
      this.onLog(`dispatcher tick failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      this.running = null;
    }
    if (this.stopped) return;
    if (didWork) {
      this.idleDelay = this.idleMin;
      this.schedule(this.activeMs);
    } else {
      this.schedule(this.idleDelay);
      this.idleDelay = Math.min(this.idleDelay * 2, this.idleMax);
    }
  }

  /** Graceful stop: no new ticks, wait for the in-flight tick, close the store. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.running) await this.running.catch(() => {});
    this.store.close();
  }

  get isRunning(): boolean {
    return this.running !== null;
  }
}

const EMPTY: ReadonlySet<string> = new Set();
