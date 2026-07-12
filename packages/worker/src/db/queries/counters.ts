/** Named per-guild counters (increment_counter action of custom commands). */

export async function incrementCounter(db: D1Database, guildId: string, name: string, amount: number): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO counters (guild_id, name, value) VALUES (?1, ?2, ?3)
       ON CONFLICT(guild_id, name) DO UPDATE SET value = value + ?3, updated_at = datetime('now')
       RETURNING value`,
    )
    .bind(guildId, name, amount)
    .first<{ value: number }>();
  return row!.value;
}

export async function getCounterValues(db: D1Database, guildId: string, names: string[]): Promise<Record<string, number>> {
  const values: Record<string, number> = {};
  if (names.length === 0) return values;
  const placeholders = names.map((_, i) => `?${i + 2}`).join(",");
  const rows = await db
    .prepare(`SELECT name, value FROM counters WHERE guild_id = ?1 AND name IN (${placeholders})`)
    .bind(guildId, ...names)
    .all<{ name: string; value: number }>();
  for (const row of rows.results) values[row.name] = row.value;
  return values;
}
