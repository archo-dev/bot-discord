/** Developer grants storage (M13). Raw SQL only. A grant creates an entitlement
 * (source='granted') AND a developer_grants row, linked both ways (origin_ref).
 * Revocation is guarded in SQL so a `paid` entitlement can NEVER be revoked via
 * this path (invariant 6 / doc 06) — the revocability derives from source. */

import type { GrantablePlan, GrantDurationKind } from "@bot/shared";
import { insertEntitlement } from "./entitlements.js";

export interface DeveloperGrantRow {
  id: number;
  entitlement_id: number;
  granted_by: string;
  reason: string;
  internal_note: string | null;
  duration_kind: string;
  created_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export interface InsertGrantInput {
  userId: string;
  planId: GrantablePlan;
  startAt: string;
  endAt: string | null;
  isLifetime: boolean;
  durationKind: GrantDurationKind;
  grantedBy: string;
  reason: string;
  internalNote?: string | null;
  /**
   * Structured origin marker for entitlements.origin_ref. Default (undefined) →
   * the grant id (invariant 7, standard offered access). Pass EARLY_ACCESS_ORIGIN_REF
   * for a beta access (OPTION A) — the developer_grants row still links back via
   * entitlement_id, so the reverse FK is preserved.
   */
  originRef?: string | null;
}

/**
 * Create a granted entitlement + its developer_grants row, then point the
 * entitlement's origin_ref at the grant (invariant 7) — or at the structured
 * early-access marker when `originRef` is supplied. Returns both ids.
 */
export async function insertGrantWithEntitlement(
  db: D1Database,
  input: InsertGrantInput,
): Promise<{ entitlementId: number; grantId: number }> {
  const entitlementId = await insertEntitlement(db, {
    userId: input.userId,
    planId: input.planId,
    source: "granted",
    status: "active",
    startAt: input.startAt,
    endAt: input.endAt,
    isLifetime: input.isLifetime,
  });
  const res = await db
    .prepare(
      `INSERT INTO developer_grants (entitlement_id, granted_by, reason, internal_note, duration_kind)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(entitlementId, input.grantedBy, input.reason, input.internalNote ?? null, input.durationKind)
    .run();
  const grantId = Number(res.meta.last_row_id);
  const originRef = input.originRef ?? String(grantId);
  await db.prepare(`UPDATE entitlements SET origin_ref = ?2 WHERE id = ?1`).bind(entitlementId, originRef).run();
  return { entitlementId, grantId };
}

export interface GrantJoinRow extends DeveloperGrantRow {
  user_id: string;
  plan_id: string;
  status: string;
  is_lifetime: number;
  start_at: string;
  end_at: string | null;
  origin_ref: string | null;
}

export async function listGrants(
  db: D1Database,
  page: number,
  pageSize: number,
): Promise<{ rows: GrantJoinRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const listStmt = db
    .prepare(
      `SELECT g.id, g.entitlement_id, g.granted_by, g.reason, g.internal_note, g.duration_kind,
              g.created_at, g.revoked_by, g.revoked_at, g.revoke_reason,
              e.user_id, e.plan_id, e.status, e.is_lifetime, e.start_at, e.end_at, e.origin_ref
         FROM developer_grants g JOIN entitlements e ON e.id = g.entitlement_id
        ORDER BY g.created_at DESC, g.id DESC LIMIT ?1 OFFSET ?2`,
    )
    .bind(pageSize, offset);
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM developer_grants`);
  const results = await db.batch<GrantJoinRow | { n: number }>([listStmt, countStmt]);
  const rows = (results[0]?.results ?? []) as GrantJoinRow[];
  const total = ((results[1]?.results?.[0] as { n: number } | undefined)?.n) ?? 0;
  return { rows, total };
}

/** The entitlement's source/status — used to enforce the paid-non-revocable guard. */
export async function getEntitlementSourceStatus(
  db: D1Database,
  entitlementId: number,
): Promise<{ source: string; status: string } | null> {
  const row = await db
    .prepare(`SELECT source, status FROM entitlements WHERE id = ?1`)
    .bind(entitlementId)
    .first<{ source: string; status: string }>();
  return row ?? null;
}

export type RevokeResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "cannot_revoke_paid" | "not_revocable" };

/**
 * Revoke a granted entitlement. Hard guard in SQL: a `paid` entitlement is never
 * touched (WHERE source != 'paid'). Never deletes — sets status='revoked' and
 * records the revocation trail on developer_grants.
 */
export async function revokeGrantedEntitlement(
  db: D1Database,
  entitlementId: number,
  revokedBy: string,
  reason: string | null,
): Promise<RevokeResult> {
  const cur = await getEntitlementSourceStatus(db, entitlementId);
  if (!cur) return { ok: false, code: "not_found" };
  if (cur.source === "paid") return { ok: false, code: "cannot_revoke_paid" };
  const res = await db
    .prepare(
      `UPDATE entitlements SET status = 'revoked', updated_at = datetime('now')
        WHERE id = ?1 AND source != 'paid' AND status = 'active'`,
    )
    .bind(entitlementId)
    .run();
  if ((res.meta.changes ?? 0) === 0) return { ok: false, code: "not_revocable" };
  await db
    .prepare(
      `UPDATE developer_grants
          SET revoked_by = ?2, revoked_at = datetime('now'), revoke_reason = ?3
        WHERE entitlement_id = ?1 AND revoked_at IS NULL`,
    )
    .bind(entitlementId, revokedBy, reason)
    .run();
  return { ok: true };
}
