/** Moderation audit log (mod_actions), paginated for the ModLog panel page. */

export interface ModActionRow {
  id: number;
  guild_id: string;
  action: string;
  target_id: string | null;
  moderator_id: string;
  reason: string | null;
  metadata: string | null;
  source: "interaction" | "panel" | "gateway";
  created_at: string;
}

export async function insertModAction(
  db: D1Database,
  entry: {
    guildId: string;
    action: string;
    targetId: string | null;
    moderatorId: string;
    reason: string | null;
    metadata?: Record<string, unknown>;
    source?: "interaction" | "panel" | "gateway";
  },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO mod_actions (guild_id, action, target_id, moderator_id, reason, metadata, source)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
    )
    .bind(
      entry.guildId,
      entry.action,
      entry.targetId,
      entry.moderatorId,
      entry.reason,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.source ?? "interaction",
    )
    .first<{ id: number }>();
  return row!.id;
}

export async function listModActions(
  db: D1Database,
  guildId: string,
  opts: { page: number; pageSize: number; action?: string; targetId?: string },
): Promise<{ rows: ModActionRow[]; total: number }> {
  const where: string[] = ["guild_id = ?1"];
  const binds: unknown[] = [guildId];
  if (opts.action) {
    binds.push(opts.action);
    where.push(`action = ?${binds.length}`);
  }
  if (opts.targetId) {
    binds.push(opts.targetId);
    where.push(`target_id = ?${binds.length}`);
  }
  const whereSql = where.join(" AND ");
  const total =
    (await db
      .prepare(`SELECT COUNT(*) AS n FROM mod_actions WHERE ${whereSql}`)
      .bind(...binds)
      .first<{ n: number }>())?.n ?? 0;
  const limit = Math.min(Math.max(opts.pageSize, 1), 100);
  const offset = Math.max(opts.page - 1, 0) * limit;
  const rows = await db
    .prepare(`SELECT * FROM mod_actions WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`)
    .bind(...binds)
    .all<ModActionRow>();
  return { rows: rows.results, total };
}
