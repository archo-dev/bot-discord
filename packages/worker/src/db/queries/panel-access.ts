/** Explicit panel access grants (roles/users, admin or read-only moderator). */

export interface PanelAccessRow {
  id: number;
  guild_id: string;
  subject_type: "role" | "user";
  subject_id: string;
  level: "admin" | "moderator";
  added_by: string;
  created_at: string;
}

export async function listPanelAccess(db: D1Database, guildId: string): Promise<PanelAccessRow[]> {
  return (
    await db.prepare(`SELECT * FROM panel_access WHERE guild_id = ?1 ORDER BY created_at`).bind(guildId).all<PanelAccessRow>()
  ).results;
}

export async function replacePanelAccess(
  db: D1Database,
  guildId: string,
  entries: Array<{ subjectType: "role" | "user"; subjectId: string; level: "admin" | "moderator" }>,
  addedBy: string,
): Promise<void> {
  const statements = [db.prepare(`DELETE FROM panel_access WHERE guild_id = ?1`).bind(guildId)];
  for (const e of entries) {
    statements.push(
      db
        .prepare(`INSERT INTO panel_access (guild_id, subject_type, subject_id, level, added_by) VALUES (?1, ?2, ?3, ?4, ?5)`)
        .bind(guildId, e.subjectType, e.subjectId, e.level, addedBy),
    );
  }
  await db.batch(statements);
}
