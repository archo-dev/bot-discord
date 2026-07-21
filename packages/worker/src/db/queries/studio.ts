/** Developer Studio storage & read helpers (M12). Raw SQL only. The operator
 * allowlist + granular permissions are the server-side source of truth for
 * dev-auth (requireDeveloper). Read views are minimized (no PII/secret). No
 * entitlement mutation lives here — grants/lifetime/revocation are M13. */

import { isStudioPermission, type StudioPermission, type StudioTicketPriority } from "@bot/shared";

export interface StudioOperatorRow {
  user_id: string;
  display_name: string | null;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** One operator by id, or null. Callers must additionally check `status='active'`. */
export async function getStudioOperator(db: D1Database, userId: string): Promise<StudioOperatorRow | null> {
  const row = await db
    .prepare(`SELECT user_id, display_name, status, note, created_at, updated_at FROM studio_operators WHERE user_id = ?1`)
    .bind(userId)
    .first<StudioOperatorRow>();
  return row ?? null;
}

/** The operator's granted permissions (validated against the known catalog). */
export async function listStudioOperatorPermissions(db: D1Database, userId: string): Promise<StudioPermission[]> {
  const res = await db
    .prepare(`SELECT permission FROM studio_operator_permissions WHERE user_id = ?1`)
    .bind(userId)
    .all<{ permission: string }>();
  return (res.results ?? []).map((r) => r.permission).filter(isStudioPermission);
}

/** Seed/test helper (no operator-management API in M12 — that is M13/settings). */
export async function insertStudioOperator(
  db: D1Database,
  input: { userId: string; displayName?: string | null; status?: "active" | "disabled"; note?: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO studio_operators (user_id, display_name, status, note)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, status = excluded.status, note = excluded.note, updated_at = datetime('now')`,
    )
    .bind(input.userId, input.displayName ?? null, input.status ?? "active", input.note ?? null)
    .run();
}

/** Seed/test helper — grant one permission to an operator. */
export async function grantStudioOperatorPermission(
  db: D1Database,
  userId: string,
  permission: StudioPermission,
  grantedBy?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO studio_operator_permissions (user_id, permission, granted_by)
       VALUES (?1, ?2, ?3) ON CONFLICT(user_id, permission) DO NOTHING`,
    )
    .bind(userId, permission, grantedBy ?? null)
    .run();
}

// --- Overview KPIs (counts only; no personal data) ---

export async function countGuildsForStudio(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM guilds`).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countActiveEntitlements(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM entitlements WHERE status = 'active'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Open (non-closed) support tickets grouped by frozen priority. */
export async function countOpenTicketsByPriority(db: D1Database): Promise<Record<StudioTicketPriority, number>> {
  const res = await db
    .prepare(
      `SELECT priority, COUNT(*) AS n FROM support_tickets
        WHERE status != 'closed' GROUP BY priority`,
    )
    .all<{ priority: string; n: number }>();
  const counts: Record<StudioTicketPriority, number> = { low: 0, normal: 0, high: 0 };
  for (const r of res.results ?? []) {
    if (r.priority === "low" || r.priority === "normal" || r.priority === "high") counts[r.priority] = r.n;
  }
  return counts;
}

// --- Read tables ---

export interface StudioGuildRow {
  id: string;
  name: string;
  bot_installed: number;
  created_at: string;
}

export async function listGuildsForStudio(
  db: D1Database,
  page: number,
  pageSize: number,
): Promise<{ rows: StudioGuildRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const listStmt = db
    .prepare(
      `SELECT id, name, bot_installed, created_at FROM guilds
        ORDER BY created_at DESC, id DESC LIMIT ?1 OFFSET ?2`,
    )
    .bind(pageSize, offset);
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM guilds`);
  const results = await db.batch<StudioGuildRow | { n: number }>([listStmt, countStmt]);
  const rows = (results[0]?.results ?? []) as StudioGuildRow[];
  const total = ((results[1]?.results?.[0] as { n: number } | undefined)?.n) ?? 0;
  return { rows, total };
}

export interface StudioEntitlementRow {
  id: number;
  user_id: string;
  plan_id: string;
  source: string;
  status: string;
  is_lifetime: number;
  start_at: string;
  end_at: string | null;
}

export async function listEntitlementsForStudio(
  db: D1Database,
  page: number,
  pageSize: number,
): Promise<{ rows: StudioEntitlementRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const listStmt = db
    .prepare(
      `SELECT id, user_id, plan_id, source, status, is_lifetime, start_at, end_at
         FROM entitlements ORDER BY created_at DESC, id DESC LIMIT ?1 OFFSET ?2`,
    )
    .bind(pageSize, offset);
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM entitlements`);
  const results = await db.batch<StudioEntitlementRow | { n: number }>([listStmt, countStmt]);
  const rows = (results[0]?.results ?? []) as StudioEntitlementRow[];
  const total = ((results[1]?.results?.[0] as { n: number } | undefined)?.n) ?? 0;
  return { rows, total };
}
