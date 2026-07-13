/** Auto-moderation settings (M12, read by the gateway). */
import { syncGuildModuleStatement } from "./modules.js";

export interface AutomodSettingsRow {
  guild_id: string;
  anti_spam_enabled: number;
  anti_spam_max_messages: number;
  anti_spam_window_seconds: number;
  anti_invite_enabled: number;
  anti_link_enabled: number;
  link_whitelist: string;
  banned_words: string;
  exempt_role_ids: string;
  exempt_channel_ids: string;
  action: "delete" | "warn" | "timeout";
  timeout_minutes: number;
}

export async function getAutomodSettings(db: D1Database, guildId: string): Promise<AutomodSettingsRow | null> {
  return db.prepare(`SELECT * FROM automod_settings WHERE guild_id = ?1`).bind(guildId).first<AutomodSettingsRow>();
}

export async function upsertAutomodSettings(
  db: D1Database,
  guildId: string,
  s: {
    antiSpamEnabled: boolean;
    antiSpamMaxMessages: number;
    antiSpamWindowSeconds: number;
    antiInviteEnabled: boolean;
    antiLinkEnabled: boolean;
    linkWhitelist: string[];
    bannedWords: string[];
    exemptRoleIds: string[];
    exemptChannelIds: string[];
    action: "delete" | "warn" | "timeout";
    timeoutMinutes: number;
  },
): Promise<void> {
  const settingsStatement = db.prepare(
      `INSERT INTO automod_settings (guild_id, anti_spam_enabled, anti_spam_max_messages, anti_spam_window_seconds,
         anti_invite_enabled, anti_link_enabled, link_whitelist, banned_words, exempt_role_ids, exempt_channel_ids,
         action, timeout_minutes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT(guild_id) DO UPDATE SET
         anti_spam_enabled = ?2, anti_spam_max_messages = ?3, anti_spam_window_seconds = ?4,
         anti_invite_enabled = ?5, anti_link_enabled = ?6, link_whitelist = ?7, banned_words = ?8,
         exempt_role_ids = ?9, exempt_channel_ids = ?10, action = ?11, timeout_minutes = ?12,
         updated_at = datetime('now')`,
    )
    .bind(
      guildId,
      s.antiSpamEnabled ? 1 : 0,
      s.antiSpamMaxMessages,
      s.antiSpamWindowSeconds,
      s.antiInviteEnabled ? 1 : 0,
      s.antiLinkEnabled ? 1 : 0,
      JSON.stringify(s.linkWhitelist),
      JSON.stringify(s.bannedWords),
      JSON.stringify(s.exemptRoleIds),
      JSON.stringify(s.exemptChannelIds),
      s.action,
      s.timeoutMinutes,
    );
  const enabled = s.antiSpamEnabled || s.antiInviteEnabled || s.antiLinkEnabled || s.bannedWords.length > 0;
  await db.batch([settingsStatement, syncGuildModuleStatement(db, guildId, "automod", enabled)]);
}
