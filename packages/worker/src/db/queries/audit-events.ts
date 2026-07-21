/** Immutable studio audit journal storage (M14). Raw SQL only. APPEND-ONLY:
 * there is an insert and a read, and deliberately NO update/delete helper — the
 * audit can never be rewritten, even by an admin operator (doc 09 §8). */

export interface AuditEventRow {
  id: number;
  actor: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface InsertAuditEventInput {
  actor: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Already masked by the caller (security/studio-audit.ts). */
  metadataJson?: string | null;
  ipHash?: string | null;
}

export async function insertAuditEvent(db: D1Database, input: InsertAuditEventInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_events (actor, action, target_type, target_id, metadata_json, ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      input.actor,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.metadataJson ?? null,
      input.ipHash ?? null,
    )
    .run();
}

export interface ListAuditEventsFilters {
  actor?: string | null;
  action?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  page: number;
  pageSize: number;
}

export async function listAuditEvents(
  db: D1Database,
  f: ListAuditEventsFilters,
): Promise<{ rows: AuditEventRow[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (col: string, val: string | null | undefined) => {
    if (val != null && val !== "") {
      args.push(val);
      where.push(`${col} = ?${args.length}`);
    }
  };
  add("actor", f.actor);
  add("action", f.action);
  add("target_type", f.targetType);
  add("target_id", f.targetId);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const offset = (f.page - 1) * f.pageSize;
  const listStmt = db
    .prepare(
      `SELECT id, actor, action, target_type, target_id, metadata_json, created_at
         FROM audit_events ${clause}
        ORDER BY created_at DESC, id DESC LIMIT ?${args.length + 1} OFFSET ?${args.length + 2}`,
    )
    .bind(...args, f.pageSize, offset);
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM audit_events ${clause}`).bind(...args);
  const results = await db.batch<AuditEventRow | { n: number }>([listStmt, countStmt]);
  const rows = (results[0]?.results ?? []) as AuditEventRow[];
  const total = ((results[1]?.results?.[0] as { n: number } | undefined)?.n) ?? 0;
  return { rows, total };
}
