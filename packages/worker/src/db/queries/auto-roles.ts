/** Auto-roles applied on member join + raw gateway event log. */

import { syncGuildModuleStatement } from "./modules.js";

export interface AutoRoleRow {
  guild_id: string;
  role_id: string;
  enabled: number;
  created_at: string;
}

export async function listAutoRoles(db: D1Database, guildId: string): Promise<AutoRoleRow[]> {
  return (await db.prepare(`SELECT * FROM auto_roles WHERE guild_id = ?1`).bind(guildId).all<AutoRoleRow>()).results;
}

export async function replaceAutoRoles(db: D1Database, guildId: string, roleIds: string[]): Promise<void> {
  const welcome = await db.prepare(
    `SELECT 1 AS present FROM welcome_settings WHERE guild_id = ?1 AND (welcome_enabled = 1 OR leave_enabled = 1) LIMIT 1`,
  ).bind(guildId).first();
  const statements = [db.prepare(`DELETE FROM auto_roles WHERE guild_id = ?1`).bind(guildId)];
  for (const roleId of roleIds) {
    statements.push(db.prepare(`INSERT INTO auto_roles (guild_id, role_id) VALUES (?1, ?2)`).bind(guildId, roleId));
  }
  statements.push(syncGuildModuleStatement(db, guildId, "welcome", roleIds.length > 0 || welcome !== null));
  await db.batch(statements);
}

export async function insertGatewayEvent(db: D1Database, guildId: string, eventType: string, payload: string): Promise<void> {
  await db
    .prepare(`INSERT INTO gateway_events (guild_id, event_type, payload) VALUES (?1, ?2, ?3)`)
    .bind(guildId, eventType, payload)
    .run();
}
