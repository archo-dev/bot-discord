import { createRequire } from "node:module";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ReliableEnvelope, ReliableEventType } from "@bot/shared";

/*
 * node:sqlite is a "node:"-only builtin (no bare "sqlite" alias). The bundler
 * (esbuild via tsup) rewrites a static `import ... from "node:sqlite"` to bare
 * "sqlite", which Node can't resolve → ERR_MODULE_NOT_FOUND. Loading it through
 * createRequire keeps the "node:sqlite" specifier verbatim at runtime, while the
 * type-only import above preserves full typing. `node:module` has a bare alias,
 * so it survives the same rewrite.
 */
const { DatabaseSync: SqliteDatabase } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/*
 * Persistent, bounded outbox (M05) backed by node:sqlite — zero external
 * dependency, WAL crash-safety, ACID, UNIQUE dedup. Single writer (the gateway
 * process). The DB file holds ONLY event envelopes (bounded, content-free) —
 * never a token, secret or Discord message content.
 */

export interface OutboxRow {
  id: number;
  event_id: string;
  type: string;
  partition_key: string;
  priority: number;
  payload: string; // JSON of the ReliableEnvelope
  created_at: number;
  available_at: number;
  attempts: number;
  status: string; // 'pending' | 'dead'
}

export type EnqueueResult = "enqueued" | "duplicate" | "dropped";

export interface OutboxMetrics {
  pending: number;
  dead: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  oldestAgeMs: number; // 0 when empty
  bytes: number;
}

export interface OutboxLimits {
  maxEvents: number;
  maxBytes: number;
}

export class OutboxStore {
  private db: DatabaseSync;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new SqliteDatabase(path);
    // WAL + NORMAL: durable across a process crash, fast enough for this volume.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id      TEXT UNIQUE NOT NULL,
        type          TEXT NOT NULL,
        partition_key TEXT NOT NULL,
        priority      INTEGER NOT NULL,
        payload       TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        available_at  INTEGER NOT NULL,
        attempts      INTEGER NOT NULL DEFAULT 0,
        status        TEXT NOT NULL DEFAULT 'pending'
      );
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, available_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_outbox_partition ON outbox(status, partition_key, available_at)");
    // Own the file: not readable by other system users (defense for the VPS).
    if (path !== ":memory:") {
      try {
        chmodSync(path, 0o600);
      } catch {
        // Windows / permission model differences: best effort.
      }
    }
  }

  /** Durable insert. Enforces capacity/bytes with priority-aware backpressure. */
  enqueue(env: ReliableEnvelope, limits: OutboxLimits): EnqueueResult {
    if (this.has(env.eventId)) return "duplicate";

    const pending = this.pendingCount();
    // Only stat the file when the queue is already sizeable — avoids a syscall
    // on every enqueue in the common (near-empty) case.
    const overCapacity = pending >= limits.maxEvents || (pending > limits.maxEvents / 2 && this.bytes() >= limits.maxBytes);
    if (overCapacity) {
      // Normal-priority events evict the oldest low-priority pending event;
      // low-priority events are simply dropped (measured by the caller).
      if (env.priority === 0) {
        const evicted = this.evictOldestLowPriority();
        if (!evicted) return "dropped";
      } else {
        return "dropped";
      }
    }

    const now = Date.now();
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO outbox (event_id, type, partition_key, priority, payload, created_at, available_at, attempts, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')`,
      )
      .run(env.eventId, env.type, env.partitionKey, env.priority, JSON.stringify(env), now, now);
    return res.changes === 1 ? "enqueued" : "duplicate";
  }

  private has(eventId: string): boolean {
    return this.db.prepare("SELECT 1 FROM outbox WHERE event_id = ?").get(eventId) !== undefined;
  }

  private evictOldestLowPriority(): boolean {
    const row = this.db
      .prepare("SELECT id FROM outbox WHERE status = 'pending' AND priority = 1 ORDER BY created_at ASC, id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    if (!row) return false;
    this.db.prepare("DELETE FROM outbox WHERE id = ?").run(row.id);
    return true;
  }

  pendingCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'").get() as { n: number };
    return row.n;
  }

  /** Distinct partitions with at least one due pending event, priority-first, excluding busy ones. */
  duePartitions(now: number, exclude: ReadonlySet<string>, limit: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT partition_key AS pk FROM outbox
         WHERE status = 'pending' AND available_at <= ?
         GROUP BY partition_key
         ORDER BY MIN(priority) ASC, MIN(available_at) ASC
         LIMIT ?`,
      )
      .all(now, limit + exclude.size) as Array<{ pk: string }>;
    const out: string[] = [];
    for (const r of rows) {
      if (exclude.has(r.pk)) continue;
      out.push(r.pk);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Oldest-first due events for one partition (ordering preserved within a partition). */
  claimBatch(now: number, partitionKey: string, limit: number): OutboxRow[] {
    return this.db
      .prepare(
        `SELECT * FROM outbox
         WHERE status = 'pending' AND available_at <= ? AND partition_key = ?
         ORDER BY priority ASC, available_at ASC, id ASC
         LIMIT ?`,
      )
      .all(now, partitionKey, limit) as unknown as OutboxRow[];
  }

  ack(eventIds: string[]): void {
    if (eventIds.length === 0) return;
    const stmt = this.db.prepare("DELETE FROM outbox WHERE event_id = ?");
    for (const id of eventIds) stmt.run(id);
  }

  reschedule(eventId: string, availableAt: number, attempts: number): void {
    this.db.prepare("UPDATE outbox SET available_at = ?, attempts = ? WHERE event_id = ?").run(availableAt, attempts, eventId);
  }

  deadLetter(eventIds: string[], attempts?: number): void {
    if (eventIds.length === 0) return;
    const stmt =
      attempts === undefined
        ? this.db.prepare("UPDATE outbox SET status = 'dead' WHERE event_id = ?")
        : this.db.prepare("UPDATE outbox SET status = 'dead', attempts = ? WHERE event_id = ?");
    for (const id of eventIds) {
      if (attempts === undefined) stmt.run(id);
      else stmt.run(attempts, id);
    }
  }

  /** Move pending events older than maxAgeMs to the dead-letter state. Returns count. */
  reapExpired(maxAgeMs: number, now: number): number {
    const res = this.db
      .prepare("UPDATE outbox SET status = 'dead' WHERE status = 'pending' AND created_at < ?")
      .run(now - maxAgeMs);
    return res.changes as number;
  }

  /** Bounds the dead-letter: keep only the most recent maxDead rows, purge older. Returns purged count. */
  purgeDeadLetter(maxDead: number): number {
    const res = this.db
      .prepare(
        `DELETE FROM outbox WHERE status = 'dead' AND id NOT IN (
           SELECT id FROM outbox WHERE status = 'dead' ORDER BY id DESC LIMIT ?
         )`,
      )
      .run(maxDead);
    return res.changes as number;
  }

  metrics(): OutboxMetrics {
    const byType: Record<string, number> = {};
    for (const r of this.db
      .prepare("SELECT type, COUNT(*) AS n FROM outbox WHERE status = 'pending' GROUP BY type")
      .all() as Array<{ type: string; n: number }>) {
      byType[r.type] = r.n;
    }
    const byPriority: Record<string, number> = {};
    for (const r of this.db
      .prepare("SELECT priority AS p, COUNT(*) AS n FROM outbox WHERE status = 'pending' GROUP BY priority")
      .all() as Array<{ p: number; n: number }>) {
      byPriority[String(r.p)] = r.n;
    }
    const pending = this.pendingCount();
    const dead = (this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'dead'").get() as { n: number }).n;
    const oldest = this.db
      .prepare("SELECT MIN(created_at) AS c FROM outbox WHERE status = 'pending'")
      .get() as { c: number | null };
    return {
      pending,
      dead,
      byType,
      byPriority,
      oldestAgeMs: oldest.c ? Math.max(0, Date.now() - oldest.c) : 0,
      bytes: this.bytes(),
    };
  }

  private bytes(): number {
    if (this.path === ":memory:") {
      const pc = this.db.prepare("PRAGMA page_count").get() as { page_count: number };
      const ps = this.db.prepare("PRAGMA page_size").get() as { page_size: number };
      return (pc?.page_count ?? 0) * (ps?.page_size ?? 0);
    }
    let total = 0;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        total += statSync(this.path + suffix).size;
      } catch {
        // file may not exist (no WAL yet)
      }
    }
    return total;
  }

  /** Parse a stored row back to its envelope; null when corrupt (poison on disk). */
  static parseEnvelope(row: OutboxRow): ReliableEnvelope | null {
    try {
      const env = JSON.parse(row.payload) as ReliableEnvelope;
      if (typeof env?.eventId === "string" && typeof env?.type === "string") return env;
      return null;
    } catch {
      return null;
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}

export type { ReliableEventType };
