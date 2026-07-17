import {
  CONFIG_BACKUP_SCHEMA_VERSION,
  MODULE_REGISTRY,
  type AutomodSnapshot,
  type BackupModuleId,
  type ConfigBackupPayload,
  type GeneralSnapshot,
} from "@bot/shared";
import { automodRowToDto } from "../api/automod.js";
import { getAutomodSettings, getGuild, getLogSettings } from "../db/queries.js";
import { syncGuildModuleStatement } from "../db/queries/modules.js";

/**
 * Allowlisted serializers: DB rows → canonical snapshot values. Only the fields
 * listed here are ever captured — no raw table dump, no secret/webhook/token.
 */

async function serializeGeneral(db: D1Database, guildId: string): Promise<GeneralSnapshot> {
  const [guild, logs] = await Promise.all([getGuild(db, guildId), getLogSettings(db, guildId)]);
  return {
    guild: {
      logChannelId: guild?.log_channel_id ?? null,
      warnThreshold: guild?.warn_threshold ?? 3,
      warnTimeoutMinutes: guild?.warn_timeout_minutes ?? 60,
      mentionCards: guild?.mention_cards === 1,
      customNickname: guild?.custom_nickname ?? null,
    },
    logSettings: {
      channelId: logs?.channel_id ?? null,
      memberJoin: logs?.log_member_join === 1,
      memberLeave: logs?.log_member_leave === 1,
      messageDelete: logs?.log_message_delete === 1,
      messageEdit: logs?.log_message_edit === 1,
      memberUpdate: logs?.log_member_update === 1,
      voiceJoin: logs?.log_voice_join === 1,
      voiceLeave: logs?.log_voice_leave === 1,
      voiceMove: logs?.log_voice_move === 1,
      voiceState: logs?.log_voice_state === 1,
    },
  };
}

async function serializeAutomod(db: D1Database, guildId: string): Promise<AutomodSnapshot> {
  return automodRowToDto(await getAutomodSettings(db, guildId));
}

export async function serializeModules(db: D1Database, guildId: string, modules: readonly BackupModuleId[]): Promise<ConfigBackupPayload> {
  const payload: ConfigBackupPayload = { schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION, modules: {} };
  if (modules.includes("general")) {
    payload.modules.general = { version: MODULE_REGISTRY.general.configVersion, values: await serializeGeneral(db, guildId) };
  }
  if (modules.includes("automod")) {
    payload.modules.automod = { version: MODULE_REGISTRY.automod.configVersion, values: await serializeAutomod(db, guildId) };
  }
  return payload;
}

/**
 * Prepared statements that write a payload back, for the selected modules only.
 * Returned as statements so restore/import runs them in a single `DB.batch` (atomic).
 * Discord references are assumed already remapped; nothing outside these tables is touched.
 */
export function restoreStatements(db: D1Database, guildId: string, payload: ConfigBackupPayload, modules: readonly BackupModuleId[]): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];

  const general = payload.modules.general;
  if (general && modules.includes("general")) {
    const g = general.values;
    statements.push(
      db.prepare(
        `UPDATE guilds SET log_channel_id = ?2, warn_threshold = ?3, warn_timeout_minutes = ?4,
           mention_cards = ?5, custom_nickname = ?6, updated_at = datetime('now') WHERE id = ?1`,
      ).bind(guildId, g.guild.logChannelId, g.guild.warnThreshold, g.guild.warnTimeoutMinutes, g.guild.mentionCards ? 1 : 0, g.guild.customNickname),
      db.prepare(
        `INSERT INTO log_settings (guild_id, channel_id, log_member_join, log_member_leave, log_message_delete,
           log_message_edit, log_member_update, log_voice_join, log_voice_leave, log_voice_move, log_voice_state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(guild_id) DO UPDATE SET
           channel_id = ?2, log_member_join = ?3, log_member_leave = ?4, log_message_delete = ?5,
           log_message_edit = ?6, log_member_update = ?7, log_voice_join = ?8, log_voice_leave = ?9,
           log_voice_move = ?10, log_voice_state = ?11, updated_at = datetime('now')`,
      ).bind(
        guildId, g.logSettings.channelId,
        g.logSettings.memberJoin ? 1 : 0, g.logSettings.memberLeave ? 1 : 0, g.logSettings.messageDelete ? 1 : 0,
        g.logSettings.messageEdit ? 1 : 0, g.logSettings.memberUpdate ? 1 : 0, g.logSettings.voiceJoin ? 1 : 0,
        g.logSettings.voiceLeave ? 1 : 0, g.logSettings.voiceMove ? 1 : 0, g.logSettings.voiceState ? 1 : 0,
      ),
    );
  }

  const automod = payload.modules.automod;
  if (automod && modules.includes("automod")) {
    const a = automod.values;
    statements.push(
      db.prepare(
        `INSERT INTO automod_settings (guild_id, anti_spam_enabled, anti_spam_max_messages, anti_spam_window_seconds,
           anti_invite_enabled, anti_link_enabled, link_whitelist, banned_words, exempt_role_ids, exempt_channel_ids,
           action, timeout_minutes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(guild_id) DO UPDATE SET
           anti_spam_enabled = ?2, anti_spam_max_messages = ?3, anti_spam_window_seconds = ?4,
           anti_invite_enabled = ?5, anti_link_enabled = ?6, link_whitelist = ?7, banned_words = ?8,
           exempt_role_ids = ?9, exempt_channel_ids = ?10, action = ?11, timeout_minutes = ?12,
           updated_at = datetime('now')`,
      ).bind(
        guildId, a.antiSpamEnabled ? 1 : 0, a.antiSpamMaxMessages, a.antiSpamWindowSeconds,
        a.antiInviteEnabled ? 1 : 0, a.antiLinkEnabled ? 1 : 0, JSON.stringify(a.linkWhitelist), JSON.stringify(a.bannedWords),
        JSON.stringify(a.exemptRoleIds), JSON.stringify(a.exemptChannelIds), a.action, a.timeoutMinutes,
      ),
      // Keep the automod governance flag consistent with the restored settings.
      syncGuildModuleStatement(db, guildId, "automod", a.antiSpamEnabled || a.antiInviteEnabled || a.antiLinkEnabled || a.bannedWords.length > 0),
    );
  }

  return statements;
}
