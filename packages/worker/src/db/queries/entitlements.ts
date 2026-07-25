/** Entitlements storage & read helpers (M6). Raw SQL only. The effective plan is
 * computed by @bot/shared resolveEffectiveEntitlement from these rows — the
 * revocability/priority logic never lives in SQL. Slot-assignment and event
 * write paths land in later milestones (M7/M9/M13). */

import type {
  EntitlementInput,
  EntitlementSource,
  EntitlementStatus,
  PlanId,
} from "@bot/shared";

export interface EntitlementRow {
  id: number;
  user_id: string;
  plan_id: string;
  source: string;
  status: string;
  start_at: string;
  end_at: string | null;
  is_lifetime: number;
  origin_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanRow {
  id: string;
  rank: number;
  display_name: string;
  slots: number;
  is_public: number;
}

/** All entitlements of a user (any status). Bounded; resolution filters the window. */
export async function listUserEntitlements(
  db: D1Database,
  userId: string,
  limit = 100,
): Promise<EntitlementRow[]> {
  const res = await db
    .prepare(
      `SELECT id, user_id, plan_id, source, status, start_at, end_at, is_lifetime,
              origin_ref, created_at, updated_at
         FROM entitlements
        WHERE user_id = ?1
        ORDER BY created_at DESC, id DESC
        LIMIT ?2`,
    )
    .bind(userId, limit)
    .all<EntitlementRow>();
  return res.results ?? [];
}

/** Map a DB row to the pure resolution input (snake → camel, 0/1 → bool). */
export function rowToEntitlementInput(row: EntitlementRow): EntitlementInput {
  return {
    planId: row.plan_id as PlanId,
    source: row.source as EntitlementSource,
    status: row.status as EntitlementStatus,
    startAt: row.start_at,
    endAt: row.end_at,
    isLifetime: row.is_lifetime === 1,
    originRef: row.origin_ref,
    createdAt: row.created_at,
  };
}

/**
 * SQL predicate that mirrors @bot/shared isEffectiveEntitlement — the SINGLE
 * source of truth for "counts as effective" in D1 reads (counts, KPIs). Both
 * sides are wrapped in datetime() so ISO-8601 (with T/.SSS/Z, from grants) and
 * the space-format datetime('now') default compare correctly (verified on D1).
 * `alias` scopes it to a joined table (e.g. "e"); empty for a bare table.
 */
export function effectiveEntitlementSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return (
    `${p}status = 'active' ` +
    `AND datetime(${p}start_at) <= datetime('now') ` +
    `AND (${p}is_lifetime = 1 OR (${p}end_at IS NOT NULL AND datetime(${p}end_at) > datetime('now')))`
  );
}

export interface ExpiredEntitlementClaim {
  id: number;
  user_id: string;
  plan_id: string;
  end_at: string | null;
}

/**
 * Atomically CLAIM a bounded batch of temporary entitlements whose window has
 * ended (status='active', not lifetime, end_at passed) → flip to 'expired' and
 * RETURN the rows actually flipped. The UPDATE is the claim: a concurrent sweep
 * (or a re-run) never re-selects an already-expired row, so each expiry is
 * transitioned — and journaled/audited — exactly once (idempotent). Lifetime and
 * scheduled (future start) rows are excluded by construction.
 */
export async function claimExpiredEntitlements(
  db: D1Database,
  limit: number,
): Promise<ExpiredEntitlementClaim[]> {
  const res = await db
    .prepare(
      `UPDATE entitlements SET status = 'expired', updated_at = datetime('now')
         WHERE id IN (
           SELECT id FROM entitlements
            WHERE status = 'active' AND is_lifetime = 0 AND end_at IS NOT NULL
              AND datetime(end_at) <= datetime('now')
            ORDER BY id
            LIMIT ?1
         )
       RETURNING id, user_id, plan_id, end_at`,
    )
    .bind(limit)
    .all<ExpiredEntitlementClaim>();
  return res.results ?? [];
}

/** Plan catalog rows (seeded referential; the app truth is @bot/shared PLANS). */
export async function listPlans(db: D1Database): Promise<PlanRow[]> {
  const res = await db
    .prepare(`SELECT id, rank, display_name, slots, is_public FROM plans ORDER BY rank ASC`)
    .all<PlanRow>();
  return res.results ?? [];
}

export interface InsertEntitlementInput {
  userId: string;
  planId: PlanId;
  source: EntitlementSource;
  status?: EntitlementStatus;
  startAt?: string;
  endAt?: string | null;
  isLifetime?: boolean;
  originRef?: string | null;
}

/**
 * Insert helper for tests and future seed/grant paths (no public mutation API in
 * M6). Enforces the lifetime/end_at invariant so callers can't build an illegal row.
 */
export async function insertEntitlement(db: D1Database, input: InsertEntitlementInput): Promise<number> {
  const isLifetime = input.isLifetime ?? false;
  const endAt = isLifetime ? null : (input.endAt ?? null);
  const res = await db
    .prepare(
      `INSERT INTO entitlements
         (user_id, plan_id, source, status, start_at, end_at, is_lifetime, origin_ref)
       VALUES (?1, ?2, ?3, ?4, COALESCE(?5, datetime('now')), ?6, ?7, ?8)`,
    )
    .bind(
      input.userId,
      input.planId,
      input.source,
      input.status ?? "active",
      input.startAt ?? null,
      endAt,
      isLifetime ? 1 : 0,
      input.originRef ?? null,
    )
    .run();
  return Number(res.meta.last_row_id);
}

/** One entitlement by id (null if absent). */
export async function getEntitlementById(db: D1Database, id: number): Promise<EntitlementRow | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, plan_id, source, status, start_at, end_at, is_lifetime,
              origin_ref, created_at, updated_at
         FROM entitlements WHERE id = ?1`,
    )
    .bind(id)
    .first<EntitlementRow>();
  return row ?? null;
}

/**
 * Update a paid entitlement's plan/status/end_at (webhook-driven). Hard guard:
 * a `paid` entitlement can NEVER be moved to `revoked` (invariant 6 / doc 06).
 */
export async function updatePaidEntitlement(
  db: D1Database,
  id: number,
  planId: PlanId,
  status: EntitlementStatus,
  endAt: string | null,
): Promise<void> {
  if (status === "revoked") throw new Error("paid_entitlement_cannot_be_revoked");
  await db
    .prepare(
      `UPDATE entitlements
          SET plan_id = ?2, status = ?3, end_at = ?4, is_lifetime = 0, updated_at = datetime('now')
        WHERE id = ?1 AND source = 'paid'`,
    )
    .bind(id, planId, status, endAt)
    .run();
}
