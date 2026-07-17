import type { PanelSanctionType, SanctionExemptionsDto } from "@bot/shared";

export async function getSanctionExemptions(db: D1Database, guildId: string): Promise<SanctionExemptionsDto> {
  const rows = await db.prepare(
    `SELECT sanction_type, role_id FROM sanction_role_exemptions WHERE guild_id = ?1 ORDER BY role_id`,
  ).bind(guildId).all<{ sanction_type: PanelSanctionType; role_id: string }>();
  const out: SanctionExemptionsDto = { warn: [], timeout: [], kick: [], ban: [] };
  for (const row of rows.results) out[row.sanction_type].push(row.role_id);
  return out;
}

export async function replaceSanctionExemptions(
  db: D1Database,
  guildId: string,
  value: SanctionExemptionsDto,
  actorId: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM sanction_role_exemptions WHERE guild_id = ?1`).bind(guildId),
  ];
  for (const type of ["warn", "timeout", "kick", "ban"] as const) {
    for (const roleId of value[type]) {
      statements.push(db.prepare(
        `INSERT INTO sanction_role_exemptions (guild_id, sanction_type, role_id, created_by) VALUES (?1, ?2, ?3, ?4)`,
      ).bind(guildId, type, roleId, actorId));
    }
  }
  await db.batch(statements);
}

/** Request claims are only replay protection; completed claims need not live forever. */
export async function purgePanelSanctionRequests(db: D1Database): Promise<number> {
  const result = await db.prepare(
    `DELETE FROM panel_sanction_requests
      WHERE status IN ('completed', 'failed') AND updated_at < datetime('now', '-30 days')`,
  ).run();
  return result.meta.changes ?? 0;
}
