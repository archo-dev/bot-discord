/** Custom commands CRUD + revision history. */

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
