/** Guild registry + per-guild config (log channel, warn thresholds, nickname). */

export interface GuildRow {
  id: string;
  name: string;
  icon: string | null;
  bot_installed: number;
  log_channel_id: string | null;
  warn_threshold: number;
  warn_timeout_minutes: number;
  custom_nickname: string | null;
  mention_cards: number;
  created_at: string;
  updated_at: string | null;
}

/** Called on every interaction: keeps name/icon fresh and bot_installed=1. */
export async function upsertGuild(db: D1Database, id: string, name: string, icon: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO guilds (id, name, icon) VALUES (?1, ?2, ?3)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         icon = excluded.icon,
         bot_installed = 1,
         updated_at = datetime('now')`,
    )
    .bind(id, name, icon)
    .run();
}

export async function getGuild(db: D1Database, id: string): Promise<GuildRow | null> {
  return db.prepare(`SELECT * FROM guilds WHERE id = ?1`).bind(id).first<GuildRow>();
}

export async function updateGuildConfig(
  db: D1Database,
  id: string,
  patch: { log_channel_id?: string | null; warn_threshold?: number; warn_timeout_minutes?: number; mention_cards?: number },
): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if ("log_channel_id" in patch) {
    binds.push(patch.log_channel_id);
    sets.push(`log_channel_id = ?${binds.length}`);
  }
  if (patch.warn_threshold !== undefined) {
    binds.push(patch.warn_threshold);
    sets.push(`warn_threshold = ?${binds.length}`);
  }
  if (patch.warn_timeout_minutes !== undefined) {
    binds.push(patch.warn_timeout_minutes);
    sets.push(`warn_timeout_minutes = ?${binds.length}`);
  }
  if (patch.mention_cards !== undefined) {
    binds.push(patch.mention_cards);
    sets.push(`mention_cards = ?${binds.length}`);
  }
  if (sets.length === 0) return;
  binds.push(id);
  await db
    .prepare(`UPDATE guilds SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?${binds.length}`)
    .bind(...binds)
    .run();
}

/** Stores the bot's per-guild custom nickname (null = none). Applied to Discord separately. */
export async function setGuildNickname(db: D1Database, id: string, nickname: string | null): Promise<void> {
  await db
    .prepare(`UPDATE guilds SET custom_nickname = ?2, updated_at = datetime('now') WHERE id = ?1`)
    .bind(id, nickname)
    .run();
}

export async function setBotInstalled(db: D1Database, id: string, installed: boolean): Promise<void> {
  await db
    .prepare(`UPDATE guilds SET bot_installed = ?2, updated_at = datetime('now') WHERE id = ?1`)
    .bind(id, installed ? 1 : 0)
    .run();
}

/** Of the given guild ids, which have the bot installed? */
export async function filterInstalledGuilds(db: D1Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const installed = new Set<string>();
  // D1 caps bound parameters; chunk to stay well under the limit.
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const placeholders = chunk.map((_, j) => `?${j + 1}`).join(",");
    const rows = await db
      .prepare(`SELECT id FROM guilds WHERE bot_installed = 1 AND id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: string }>();
    for (const row of rows.results) installed.add(row.id);
  }
  return installed;
}
