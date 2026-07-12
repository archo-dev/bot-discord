/** Welcome/leave messages + server log settings (M11, read by the gateway). */

export interface WelcomeSettingsRow {
  guild_id: string;
  welcome_enabled: number;
  welcome_channel_id: string | null;
  welcome_message: string;
  leave_enabled: number;
  leave_channel_id: string | null;
  leave_message: string;
}

export async function getWelcomeSettings(db: D1Database, guildId: string): Promise<WelcomeSettingsRow | null> {
  return db.prepare(`SELECT * FROM welcome_settings WHERE guild_id = ?1`).bind(guildId).first<WelcomeSettingsRow>();
}

export async function upsertWelcomeSettings(
  db: D1Database,
  guildId: string,
  s: {
    welcomeEnabled: boolean;
    welcomeChannelId: string | null;
    welcomeMessage: string;
    leaveEnabled: boolean;
    leaveChannelId: string | null;
    leaveMessage: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO welcome_settings (guild_id, welcome_enabled, welcome_channel_id, welcome_message, leave_enabled, leave_channel_id, leave_message)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(guild_id) DO UPDATE SET
         welcome_enabled = ?2, welcome_channel_id = ?3, welcome_message = ?4,
         leave_enabled = ?5, leave_channel_id = ?6, leave_message = ?7,
         updated_at = datetime('now')`,
    )
    .bind(guildId, s.welcomeEnabled ? 1 : 0, s.welcomeChannelId, s.welcomeMessage, s.leaveEnabled ? 1 : 0, s.leaveChannelId, s.leaveMessage)
    .run();
}

export interface LogSettingsRow {
  guild_id: string;
  channel_id: string | null;
  log_member_join: number;
  log_member_leave: number;
  log_message_delete: number;
  log_message_edit: number;
  log_member_update: number;
  log_voice_join: number;
  log_voice_leave: number;
  log_voice_move: number;
  log_voice_state: number;
}

export async function getLogSettings(db: D1Database, guildId: string): Promise<LogSettingsRow | null> {
  return db.prepare(`SELECT * FROM log_settings WHERE guild_id = ?1`).bind(guildId).first<LogSettingsRow>();
}

export async function upsertLogSettings(
  db: D1Database,
  guildId: string,
  s: {
    channelId: string | null;
    memberJoin: boolean;
    memberLeave: boolean;
    messageDelete: boolean;
    messageEdit: boolean;
    memberUpdate: boolean;
    voiceJoin: boolean;
    voiceLeave: boolean;
    voiceMove: boolean;
    voiceState: boolean;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO log_settings (guild_id, channel_id, log_member_join, log_member_leave, log_message_delete, log_message_edit, log_member_update,
         log_voice_join, log_voice_leave, log_voice_move, log_voice_state)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(guild_id) DO UPDATE SET
         channel_id = ?2, log_member_join = ?3, log_member_leave = ?4,
         log_message_delete = ?5, log_message_edit = ?6, log_member_update = ?7,
         log_voice_join = ?8, log_voice_leave = ?9, log_voice_move = ?10, log_voice_state = ?11,
         updated_at = datetime('now')`,
    )
    .bind(
      guildId,
      s.channelId,
      s.memberJoin ? 1 : 0,
      s.memberLeave ? 1 : 0,
      s.messageDelete ? 1 : 0,
      s.messageEdit ? 1 : 0,
      s.memberUpdate ? 1 : 0,
      s.voiceJoin ? 1 : 0,
      s.voiceLeave ? 1 : 0,
      s.voiceMove ? 1 : 0,
      s.voiceState ? 1 : 0,
    )
    .run();
}
