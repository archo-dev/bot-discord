import { MODULE_DEFINITIONS, MODULE_REGISTRY, type ModuleId } from "@bot/shared";

export interface GuildModuleRow {
  guild_id: string;
  module_id: ModuleId;
  enabled: number;
  config_version: number;
  authority: "legacy" | "governance";
  updated_at: string;
}

const LEGACY_MODULES = new Set<ModuleId>(["tickets", "welcome", "automod", "levels", "starboard", "temp_voice"]);

interface LegacySignals {
  tickets: number;
  welcome: number;
  automod: number;
  levels: number;
  starboard: number;
  temp_voice: number;
}

async function legacySignals(db: D1Database, guildId: string): Promise<LegacySignals> {
  return (await db.prepare(
    `SELECT
      COALESCE((SELECT enabled FROM ticket_settings WHERE guild_id = ?1), 0) AS tickets,
      CASE WHEN COALESCE((SELECT welcome_enabled OR leave_enabled FROM welcome_settings WHERE guild_id = ?1), 0) = 1
        OR EXISTS (SELECT 1 FROM auto_roles WHERE guild_id = ?1 AND enabled = 1) THEN 1 ELSE 0 END AS welcome,
      CASE WHEN COALESCE((SELECT anti_spam_enabled OR anti_invite_enabled OR anti_link_enabled OR banned_words <> '[]'
                           FROM automod_settings WHERE guild_id = ?1), 0) = 1 THEN 1 ELSE 0 END AS automod,
      COALESCE((SELECT enabled FROM xp_settings WHERE guild_id = ?1), 0) AS levels,
      COALESCE((SELECT enabled FROM starboard_settings WHERE guild_id = ?1), 0) AS starboard,
      COALESCE((SELECT enabled FROM guild_tempvoice_settings WHERE guild_id = ?1), 0) AS temp_voice`,
  ).bind(guildId).first<LegacySignals>())!;
}

export async function ensureGuildModules(db: D1Database, guildId: string): Promise<void> {
  await db.batch(MODULE_DEFINITIONS.map((definition) => db.prepare(
    `INSERT INTO guild_modules (guild_id, module_id, enabled, config_version, authority)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(guild_id, module_id) DO NOTHING`,
  ).bind(
    guildId,
    definition.id,
    definition.defaultEnabled ? 1 : 0,
    definition.configVersion,
    LEGACY_MODULES.has(definition.id) ? "legacy" : "governance",
  )));
}

export async function listGuildModuleRows(db: D1Database, guildId: string): Promise<GuildModuleRow[]> {
  await ensureGuildModules(db, guildId);
  const result = await db.prepare(
    `SELECT guild_id, module_id, enabled, config_version, authority, updated_at
       FROM guild_modules WHERE guild_id = ?1 ORDER BY module_id`,
  ).bind(guildId).all<GuildModuleRow>();
  return result.results;
}

export async function listEffectiveGuildModules(db: D1Database, guildId: string): Promise<GuildModuleRow[]> {
  const [rows, legacy] = await Promise.all([listGuildModuleRows(db, guildId), legacySignals(db, guildId)]);
  return rows.map((row) => {
    if (row.authority !== "legacy" || !LEGACY_MODULES.has(row.module_id)) return row;
    return { ...row, enabled: legacy[row.module_id as keyof LegacySignals] };
  });
}

export async function isGuildModuleEnabled(db: D1Database, guildId: string, moduleId: ModuleId): Promise<boolean> {
  const guild = await db.prepare(`SELECT 1 AS present FROM guilds WHERE id = ?1`).bind(guildId).first();
  if (!guild) return MODULE_REGISTRY[moduleId].defaultEnabled || MODULE_REGISTRY[moduleId].toggleable === false;
  const rows = await listEffectiveGuildModules(db, guildId);
  const row = rows.find((candidate) => candidate.module_id === moduleId);
  return row?.enabled === 1 || MODULE_REGISTRY[moduleId].toggleable === false;
}

export async function setGuildModuleEnabled(db: D1Database, guildId: string, moduleId: ModuleId, enabled: boolean): Promise<void> {
  const definition = MODULE_REGISTRY[moduleId];
  await db.prepare(
    `INSERT INTO guild_modules (guild_id, module_id, enabled, config_version, authority, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'governance', datetime('now'))
     ON CONFLICT(guild_id, module_id) DO UPDATE SET
       enabled = excluded.enabled,
       config_version = excluded.config_version,
       authority = 'governance',
       updated_at = datetime('now')`,
  ).bind(guildId, moduleId, enabled ? 1 : 0, definition.configVersion).run();
}

export async function syncGuildModuleEnabled(db: D1Database, guildId: string, moduleId: ModuleId, enabled: boolean): Promise<void> {
  await setGuildModuleEnabled(db, guildId, moduleId, enabled);
}

/** Prepared form used to keep a legacy settings write and its governance row in one D1 batch. */
export function syncGuildModuleStatement(
  db: D1Database,
  guildId: string,
  moduleId: ModuleId,
  enabled: boolean,
): D1PreparedStatement {
  const definition = MODULE_REGISTRY[moduleId];
  return db.prepare(
    `INSERT INTO guild_modules (guild_id, module_id, enabled, config_version, authority, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'governance', datetime('now'))
     ON CONFLICT(guild_id, module_id) DO UPDATE SET
       enabled = excluded.enabled,
       config_version = excluded.config_version,
       authority = 'governance',
       updated_at = datetime('now')`,
  ).bind(guildId, moduleId, enabled ? 1 : 0, definition.configVersion);
}

export interface ModuleConfigurationSignals {
  tickets: boolean;
  welcome: boolean;
  automod: boolean;
  levels: boolean;
  starboard: boolean;
  temp_voice: boolean;
}

export async function getModuleConfigurationSignals(db: D1Database, guildId: string): Promise<ModuleConfigurationSignals> {
  const row = (await db.prepare(
    `SELECT
      EXISTS (SELECT 1 FROM ticket_settings WHERE guild_id = ?1 AND category_id IS NOT NULL) AS tickets,
      CASE WHEN EXISTS (SELECT 1 FROM welcome_settings WHERE guild_id = ?1 AND
        ((welcome_enabled = 1 AND welcome_channel_id IS NOT NULL) OR (leave_enabled = 1 AND leave_channel_id IS NOT NULL)))
        OR EXISTS (SELECT 1 FROM auto_roles WHERE guild_id = ?1 AND enabled = 1) THEN 1 ELSE 0 END AS welcome,
      EXISTS (SELECT 1 FROM automod_settings WHERE guild_id = ?1 AND
        (anti_spam_enabled = 1 OR anti_invite_enabled = 1 OR anti_link_enabled = 1 OR banned_words <> '[]')) AS automod,
      EXISTS (SELECT 1 FROM xp_settings WHERE guild_id = ?1) AS levels,
      EXISTS (SELECT 1 FROM starboard_settings WHERE guild_id = ?1 AND channel_id IS NOT NULL) AS starboard,
      EXISTS (SELECT 1 FROM guild_tempvoice_settings WHERE guild_id = ?1 AND lobby_channel_id IS NOT NULL) AS temp_voice`,
  ).bind(guildId).first<Record<keyof ModuleConfigurationSignals, number>>())!;
  return {
    tickets: row.tickets === 1,
    welcome: row.welcome === 1,
    automod: row.automod === 1,
    levels: row.levels === 1,
    starboard: row.starboard === 1,
    temp_voice: row.temp_voice === 1,
  };
}
