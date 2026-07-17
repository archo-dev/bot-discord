/** Warnings: insert/list/revoke + active count (feeds the auto-timeout threshold). */

export interface WarningRow {
  id: number;
  guild_id: string;
  user_id: string;
  moderator_id: string;
  reason: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

export async function insertWarning(
  db: D1Database,
  guildId: string,
  userId: string,
  moderatorId: string,
  reason: string | null,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO warnings (guild_id, user_id, moderator_id, reason)
       VALUES (?1, ?2, ?3, ?4) RETURNING id`,
    )
    .bind(guildId, userId, moderatorId, reason)
    .first<{ id: number }>();
  return row!.id;
}

export async function activeWarningCount(db: D1Database, guildId: string, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ?1 AND user_id = ?2 AND revoked_at IS NULL`)
    .bind(guildId, userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listWarnings(db: D1Database, guildId: string, userId?: string): Promise<WarningRow[]> {
  const stmt = userId
    ? db
        .prepare(`SELECT * FROM warnings WHERE guild_id = ?1 AND user_id = ?2 ORDER BY created_at DESC LIMIT 100`)
        .bind(guildId, userId)
    : db.prepare(`SELECT * FROM warnings WHERE guild_id = ?1 ORDER BY created_at DESC LIMIT 100`).bind(guildId);
  return (await stmt.all<WarningRow>()).results;
}

export async function revokeWarning(
  db: D1Database,
  guildId: string,
  warningId: number,
  revokedBy: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE warnings SET revoked_at = datetime('now'), revoked_by = ?3
       WHERE id = ?2 AND guild_id = ?1 AND revoked_at IS NULL`,
    )
    .bind(guildId, warningId, revokedBy)
    .run();
  return res.meta.changes > 0;
}

export async function updateWarningReason(db: D1Database, guildId: string, warningId: number, reason: string | null): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE warnings SET reason = ?3, updated_at = datetime('now') WHERE guild_id = ?1 AND id = ?2`,
  ).bind(guildId, warningId, reason).run();
  return (result.meta.changes ?? 0) === 1;
}
