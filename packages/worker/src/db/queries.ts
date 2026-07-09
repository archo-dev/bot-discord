/** Typed D1 query helpers — the only place raw SQL lives. */

// ---------------------------------------------------------------------------
// Row types (snake_case mirrors the schema)
// ---------------------------------------------------------------------------

export interface GuildRow {
  id: string;
  name: string;
  icon: string | null;
  bot_installed: number;
  log_channel_id: string | null;
  warn_threshold: number;
  warn_timeout_minutes: number;
  created_at: string;
  updated_at: string | null;
}

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

export interface CustomCommandRow {
  id: number;
  guild_id: string;
  name: string;
  description: string;
  trigger_type: "slash" | "keyword";
  enabled: number;
  logic: string;
  logic_version: number;
  cooldown_seconds: number;
  cooldown_scope: "user" | "guild";
  required_permissions: string | null;
  discord_command_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

export interface CommandRevisionRow {
  id: number;
  command_id: number;
  guild_id: string;
  change_type: "create" | "update" | "enable" | "disable" | "delete";
  logic: string;
  changed_by: string;
  changed_at: string;
}

export interface PanelAccessRow {
  id: number;
  guild_id: string;
  subject_type: "role" | "user";
  subject_id: string;
  added_by: string;
  created_at: string;
}

export interface AutoRoleRow {
  guild_id: string;
  role_id: string;
  enabled: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Guilds
// ---------------------------------------------------------------------------

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
  patch: { log_channel_id?: string | null; warn_threshold?: number; warn_timeout_minutes?: number },
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
  if (sets.length === 0) return;
  binds.push(id);
  await db
    .prepare(`UPDATE guilds SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?${binds.length}`)
    .bind(...binds)
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

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mod actions
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Custom commands + revisions
// ---------------------------------------------------------------------------

export async function countCustomCommands(db: D1Database, guildId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM custom_commands WHERE guild_id = ?1`)
    .bind(guildId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listCustomCommands(db: D1Database, guildId: string): Promise<CustomCommandRow[]> {
  return (
    await db.prepare(`SELECT * FROM custom_commands WHERE guild_id = ?1 ORDER BY name`).bind(guildId).all<CustomCommandRow>()
  ).results;
}

export async function getCustomCommandById(db: D1Database, guildId: string, id: number): Promise<CustomCommandRow | null> {
  return db
    .prepare(`SELECT * FROM custom_commands WHERE guild_id = ?1 AND id = ?2`)
    .bind(guildId, id)
    .first<CustomCommandRow>();
}

export async function getEnabledSlashCommand(db: D1Database, guildId: string, name: string): Promise<CustomCommandRow | null> {
  return db
    .prepare(
      `SELECT * FROM custom_commands
       WHERE guild_id = ?1 AND name = ?2 AND enabled = 1 AND trigger_type = 'slash'`,
    )
    .bind(guildId, name)
    .first<CustomCommandRow>();
}

export async function insertCustomCommand(
  db: D1Database,
  cmd: {
    guildId: string;
    name: string;
    description: string;
    triggerType: "slash" | "keyword";
    logic: string;
    cooldownSeconds: number;
    cooldownScope: "user" | "guild";
    requiredPermissions: string | null;
    createdBy: string;
  },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO custom_commands
         (guild_id, name, description, trigger_type, logic, cooldown_seconds, cooldown_scope, required_permissions, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
    )
    .bind(
      cmd.guildId,
      cmd.name,
      cmd.description,
      cmd.triggerType,
      cmd.logic,
      cmd.cooldownSeconds,
      cmd.cooldownScope,
      cmd.requiredPermissions,
      cmd.createdBy,
    )
    .first<{ id: number }>();
  return row!.id;
}

export async function updateCustomCommand(
  db: D1Database,
  guildId: string,
  id: number,
  patch: {
    name: string;
    description: string;
    triggerType: "slash" | "keyword";
    logic: string;
    cooldownSeconds: number;
    cooldownScope: "user" | "guild";
    requiredPermissions: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE custom_commands SET
         name = ?3, description = ?4, trigger_type = ?5, logic = ?6,
         cooldown_seconds = ?7, cooldown_scope = ?8, required_permissions = ?9,
         updated_at = datetime('now')
       WHERE guild_id = ?1 AND id = ?2`,
    )
    .bind(guildId, id, patch.name, patch.description, patch.triggerType, patch.logic, patch.cooldownSeconds, patch.cooldownScope, patch.requiredPermissions)
    .run();
}

export async function setCommandEnabled(db: D1Database, guildId: string, id: number, enabled: boolean): Promise<void> {
  await db
    .prepare(`UPDATE custom_commands SET enabled = ?3, updated_at = datetime('now') WHERE guild_id = ?1 AND id = ?2`)
    .bind(guildId, id, enabled ? 1 : 0)
    .run();
}

export async function setDiscordCommandId(db: D1Database, guildId: string, id: number, discordCommandId: string | null): Promise<void> {
  await db
    .prepare(`UPDATE custom_commands SET discord_command_id = ?3 WHERE guild_id = ?1 AND id = ?2`)
    .bind(guildId, id, discordCommandId)
    .run();
}

export async function deleteCustomCommand(db: D1Database, guildId: string, id: number): Promise<void> {
  await db.prepare(`DELETE FROM custom_commands WHERE guild_id = ?1 AND id = ?2`).bind(guildId, id).run();
}

export async function insertCommandRevision(
  db: D1Database,
  rev: {
    commandId: number;
    guildId: string;
    changeType: "create" | "update" | "enable" | "disable" | "delete";
    logic: string;
    changedBy: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO custom_command_revisions (command_id, guild_id, change_type, logic, changed_by)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(rev.commandId, rev.guildId, rev.changeType, rev.logic, rev.changedBy)
    .run();
}

export async function listCommandRevisions(db: D1Database, guildId: string, commandId: number): Promise<CommandRevisionRow[]> {
  return (
    await db
      .prepare(
        `SELECT * FROM custom_command_revisions WHERE guild_id = ?1 AND command_id = ?2
         ORDER BY changed_at DESC, id DESC LIMIT 50`,
      )
      .bind(guildId, commandId)
      .all<CommandRevisionRow>()
  ).results;
}

// ---------------------------------------------------------------------------
// Panel access
// ---------------------------------------------------------------------------

export async function listPanelAccess(db: D1Database, guildId: string): Promise<PanelAccessRow[]> {
  return (
    await db.prepare(`SELECT * FROM panel_access WHERE guild_id = ?1 ORDER BY created_at`).bind(guildId).all<PanelAccessRow>()
  ).results;
}

export async function replacePanelAccess(
  db: D1Database,
  guildId: string,
  entries: Array<{ subjectType: "role" | "user"; subjectId: string }>,
  addedBy: string,
): Promise<void> {
  const statements = [db.prepare(`DELETE FROM panel_access WHERE guild_id = ?1`).bind(guildId)];
  for (const e of entries) {
    statements.push(
      db
        .prepare(`INSERT INTO panel_access (guild_id, subject_type, subject_id, added_by) VALUES (?1, ?2, ?3, ?4)`)
        .bind(guildId, e.subjectType, e.subjectId, addedBy),
    );
  }
  await db.batch(statements);
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Auto roles + gateway events (gateway-dependent, inert until Option B)
// ---------------------------------------------------------------------------

export async function listAutoRoles(db: D1Database, guildId: string): Promise<AutoRoleRow[]> {
  return (await db.prepare(`SELECT * FROM auto_roles WHERE guild_id = ?1`).bind(guildId).all<AutoRoleRow>()).results;
}

export async function replaceAutoRoles(db: D1Database, guildId: string, roleIds: string[]): Promise<void> {
  const statements = [db.prepare(`DELETE FROM auto_roles WHERE guild_id = ?1`).bind(guildId)];
  for (const roleId of roleIds) {
    statements.push(db.prepare(`INSERT INTO auto_roles (guild_id, role_id) VALUES (?1, ?2)`).bind(guildId, roleId));
  }
  await db.batch(statements);
}

export async function insertGatewayEvent(db: D1Database, guildId: string, eventType: string, payload: string): Promise<void> {
  await db
    .prepare(`INSERT INTO gateway_events (guild_id, event_type, payload) VALUES (?1, ?2, ?3)`)
    .bind(guildId, eventType, payload)
    .run();
}
