/** Server-slot assignment storage (M7). Raw SQL only. The active/suspended split
 * and cooldown decisions use @bot/shared pure helpers; this file just reads/writes
 * rows. Lifecycle within the 0033 schema:
 *   live/active  : state='active'  AND released_at IS NULL  (consumes a slot)
 *   suspended    : state='suspended' AND released_at IS NULL (over-capacity, kept)
 *   released     : released_at IS NOT NULL (state set 'suspended' to free the
 *                  partial unique index on (guild_id) WHERE state='active') */

import type { EntitlementRow } from "./entitlements.js";

export interface AssignmentRow {
  id: number;
  entitlement_id: number;
  guild_id: string;
  assigned_at: string;
  assigned_by: string | null;
  state: string;
  last_reassigned_at: string | null;
  released_at: string | null;
}

const COLUMNS = `id, entitlement_id, guild_id, assigned_at, assigned_by, state, last_reassigned_at, released_at`;

/** Non-released assignments across a user's entitlements, most-recent first. */
export async function listUserAssignments(db: D1Database, userId: string): Promise<AssignmentRow[]> {
  const res = await db
    .prepare(
      `SELECT ${COLUMNS.split(", ").map((c) => `a.${c}`).join(", ")}
         FROM entitlement_guild_assignments a
         JOIN entitlements e ON e.id = a.entitlement_id
        WHERE e.user_id = ?1 AND a.released_at IS NULL
        ORDER BY COALESCE(a.last_reassigned_at, a.assigned_at) DESC, a.id DESC`,
    )
    .bind(userId)
    .all<AssignmentRow>();
  return res.results ?? [];
}

/** The live (slot-consuming) assignment of a guild, or null. */
export async function getGuildLiveAssignment(db: D1Database, guildId: string): Promise<AssignmentRow | null> {
  const row = await db
    .prepare(
      `SELECT ${COLUMNS} FROM entitlement_guild_assignments
        WHERE guild_id = ?1 AND state = 'active' AND released_at IS NULL LIMIT 1`,
    )
    .bind(guildId)
    .first<AssignmentRow>();
  return row ?? null;
}

/** The entitlement backing a guild's live assignment (for effective-plan resolution). */
export async function getGuildEntitlementRow(db: D1Database, guildId: string): Promise<EntitlementRow | null> {
  const row = await db
    .prepare(
      `SELECT e.id, e.user_id, e.plan_id, e.source, e.status, e.start_at, e.end_at,
              e.is_lifetime, e.origin_ref, e.created_at, e.updated_at
         FROM entitlement_guild_assignments a
         JOIN entitlements e ON e.id = a.entitlement_id
        WHERE a.guild_id = ?1 AND a.state = 'active' AND a.released_at IS NULL LIMIT 1`,
    )
    .bind(guildId)
    .first<EntitlementRow>();
  return row ?? null;
}

/** Most recent release time of a guild (cooldown gate), or null if never released. */
export async function getGuildLastReleasedAt(db: D1Database, guildId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MAX(released_at) AS r FROM entitlement_guild_assignments
        WHERE guild_id = ?1 AND released_at IS NOT NULL`,
    )
    .bind(guildId)
    .first<{ r: string | null }>();
  return row?.r ?? null;
}

export async function insertAssignment(
  db: D1Database,
  entitlementId: number,
  guildId: string,
  assignedBy: string | null,
  now?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entitlement_guild_assignments
         (entitlement_id, guild_id, assigned_by, assigned_at, last_reassigned_at, state)
       VALUES (?1, ?2, ?3, COALESCE(?4, datetime('now')), COALESCE(?4, datetime('now')), 'active')`,
    )
    .bind(entitlementId, guildId, assignedBy, now ?? null)
    .run();
}

/** Release a guild's live assignment: free the slot, keep the row (history/cooldown).
 *  Over-capacity suspension is derived on the fly (resolveSlotAssignments), never
 *  persisted, so reads stay write-free; only release mutates state here. */
export async function releaseGuildAssignment(db: D1Database, guildId: string, now?: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE entitlement_guild_assignments
          SET released_at = COALESCE(?2, datetime('now')), state = 'suspended'
        WHERE guild_id = ?1 AND state = 'active' AND released_at IS NULL`,
    )
    .bind(guildId, now ?? null)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
