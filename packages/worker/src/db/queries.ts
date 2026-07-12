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
  custom_nickname: string | null;
  mention_cards: number;
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
  level: "admin" | "moderator";
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
// Stats collection (M18) — written by the gateway via /internal
// ---------------------------------------------------------------------------

/** Hourly member snapshot; INSERT OR REPLACE so a re-sent bucket overwrites. */
export async function upsertMemberSnapshot(
  db: D1Database,
  guildId: string,
  s: { bucket: string; total: number; humans: number; bots: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO member_snapshots (guild_id, bucket, total, humans, bots)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(guildId, s.bucket, s.total, s.humans, s.bots)
    .run();
}

export interface ChannelActivityEntry {
  channelId: string;
  day: string;
  messageCount: number;
  voiceSeconds: number;
}

/** Additive upsert: repeated flushes for the same channel/day accumulate. */
export async function incrementChannelActivity(
  db: D1Database,
  guildId: string,
  entries: ChannelActivityEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const statements = entries.map((e) =>
    db
      .prepare(
        `INSERT INTO channel_activity (guild_id, channel_id, day, message_count, voice_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(guild_id, channel_id, day) DO UPDATE SET
           message_count = message_count + excluded.message_count,
           voice_seconds = voice_seconds + excluded.voice_seconds`,
      )
      .bind(guildId, e.channelId, e.day, e.messageCount, e.voiceSeconds),
  );
  await db.batch(statements);
}

/**
 * Retention purge (daily cron). Returns rows deleted per table. Bounds (actées) :
 *  - voice_logs        > 90 j
 *  - channel_activity  > 180 j
 *  - member_snapshots  : horaires (bucket != T00:00) > 14 j ; tout > 400 j
 */
export async function purgeOldStats(db: D1Database): Promise<{
  voiceLogs: number;
  channelActivity: number;
  hourlySnapshots: number;
  oldSnapshots: number;
}> {
  const r = await db.batch([
    db.prepare(`DELETE FROM voice_logs WHERE created_at < datetime('now', '-90 days')`),
    db.prepare(`DELETE FROM channel_activity WHERE day < date('now', '-180 days')`),
    db.prepare(
      `DELETE FROM member_snapshots WHERE bucket NOT LIKE '%T00:00' AND created_at < datetime('now', '-14 days')`,
    ),
    db.prepare(`DELETE FROM member_snapshots WHERE created_at < datetime('now', '-400 days')`),
  ]);
  return {
    voiceLogs: r[0]!.meta.changes ?? 0,
    channelActivity: r[1]!.meta.changes ?? 0,
    hourlySnapshots: r[2]!.meta.changes ?? 0,
    oldSnapshots: r[3]!.meta.changes ?? 0,
  };
}

/** Member snapshots over the last N days; hourly (7d) or daily-only (T00:00). */
export async function listMemberSnapshots(
  db: D1Database,
  guildId: string,
  days: number,
  granularity: "hourly" | "daily",
): Promise<Array<{ bucket: string; total: number; humans: number; bots: number }>> {
  const dailyFilter = granularity === "daily" ? `AND bucket LIKE '%T00:00'` : "";
  return (
    await db
      .prepare(
        `SELECT bucket, total, humans, bots FROM member_snapshots
         WHERE guild_id = ?1 AND created_at >= datetime('now', ?2) ${dailyFilter}
         ORDER BY bucket ASC`,
      )
      .bind(guildId, `-${days} days`)
      .all<{ bucket: string; total: number; humans: number; bots: number }>()
  ).results;
}

/** Daily join/leave counts derived from gateway_events (retroactive). */
export async function listMemberDeltas(
  db: D1Database,
  guildId: string,
  days: number,
): Promise<Array<{ day: string; joins: number; leaves: number }>> {
  return (
    await db
      .prepare(
        `SELECT date(created_at) AS day,
                SUM(CASE WHEN event_type = 'member_join' THEN 1 ELSE 0 END) AS joins,
                SUM(CASE WHEN event_type = 'member_leave' THEN 1 ELSE 0 END) AS leaves
         FROM gateway_events
         WHERE guild_id = ?1 AND event_type IN ('member_join','member_leave') AND created_at >= datetime('now', ?2)
         GROUP BY day ORDER BY day ASC`,
      )
      .bind(guildId, `-${days} days`)
      .all<{ day: string; joins: number; leaves: number }>()
  ).results;
}

/** Top channels by message_count or voice_seconds over the last N days. */
export async function topChannels(
  db: D1Database,
  guildId: string,
  days: number,
  metric: "messages" | "voice",
  limit: number,
): Promise<Array<{ channelId: string; value: number }>> {
  const col = metric === "voice" ? "voice_seconds" : "message_count";
  return (
    await db
      .prepare(
        `SELECT channel_id AS channelId, SUM(${col}) AS value FROM channel_activity
         WHERE guild_id = ?1 AND day >= date('now', ?2)
         GROUP BY channel_id HAVING value > 0 ORDER BY value DESC LIMIT ?3`,
      )
      .bind(guildId, `-${days} days`, limit)
      .all<{ channelId: string; value: number }>()
  ).results;
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

// ---------------------------------------------------------------------------
// Welcome/leave messages + server log settings (M11, read by the gateway)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Voice logs (M17)
// ---------------------------------------------------------------------------

export interface VoiceLogRow {
  id: number;
  guild_id: string;
  user_id: string;
  user_tag: string | null;
  action: "join" | "leave" | "move" | "mute" | "unmute" | "deafen" | "undeafen";
  channel_id: string | null;
  from_channel_id: string | null;
  created_at: string;
}

export interface VoiceLogEntry {
  userId: string;
  userTag: string | null;
  action: VoiceLogRow["action"];
  channelId: string | null;
  fromChannelId: string | null;
}

/** Batch-inserts voice entries (posted by the gateway in 5 s buffers). */
export async function insertVoiceLogs(db: D1Database, guildId: string, entries: VoiceLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const statements = entries.map((e) =>
    db
      .prepare(
        `INSERT INTO voice_logs (guild_id, user_id, user_tag, action, channel_id, from_channel_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(guildId, e.userId, e.userTag, e.action, e.channelId, e.fromChannelId),
  );
  await db.batch(statements);
}

/**
 * Keyset-paginated voice history (newest first). Cursor is the last row's
 * `created_at|id`; passing it returns the next page. Returns `limit`+1-driven
 * `nextCursor` (null on the last page).
 */
export async function listVoiceLogs(
  db: D1Database,
  guildId: string,
  opts: {
    userId?: string;
    channelId?: string;
    action?: string;
    from?: string;
    to?: string;
    cursor?: { createdAt: string; id: number };
    limit: number;
  },
): Promise<{ rows: VoiceLogRow[]; nextCursor: string | null }> {
  const where: string[] = ["guild_id = ?1"];
  const binds: unknown[] = [guildId];
  const add = (clause: (n: number) => string, value: unknown) => {
    binds.push(value);
    where.push(clause(binds.length));
  };
  if (opts.userId) add((n) => `user_id = ?${n}`, opts.userId);
  if (opts.channelId) {
    binds.push(opts.channelId);
    where.push(`(channel_id = ?${binds.length} OR from_channel_id = ?${binds.length})`);
  }
  if (opts.action) add((n) => `action = ?${n}`, opts.action);
  if (opts.from) add((n) => `created_at >= ?${n}`, opts.from);
  if (opts.to) add((n) => `created_at <= ?${n}`, opts.to);
  if (opts.cursor) {
    binds.push(opts.cursor.createdAt, opts.cursor.createdAt, opts.cursor.id);
    where.push(`(created_at < ?${binds.length - 2} OR (created_at = ?${binds.length - 1} AND id < ?${binds.length}))`);
  }
  const limit = Math.min(Math.max(opts.limit, 1), 100);
  const rows = await db
    .prepare(`SELECT * FROM voice_logs WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`)
    .bind(...binds)
    .all<VoiceLogRow>();
  const results = rows.results;
  let nextCursor: string | null = null;
  if (results.length > limit) {
    const last = results[limit - 1]!;
    nextCursor = `${last.created_at}|${last.id}`;
    results.length = limit;
  }
  return { rows: results, nextCursor };
}

// ---------------------------------------------------------------------------
// Auto-moderation settings (M12, read by the gateway)
// ---------------------------------------------------------------------------

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
  await db
    .prepare(
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
    )
    .run();
}

// ---------------------------------------------------------------------------
// XP / levels (M13)
// ---------------------------------------------------------------------------

export interface XpSettingsRow {
  guild_id: string;
  enabled: number;
  xp_min: number;
  xp_max: number;
  cooldown_seconds: number;
  announce_level_up: number;
  announce_channel_id: string | null;
  rewards: string;
  voice_enabled: number;
  voice_xp_per_min: number;
}

export async function getXpSettings(db: D1Database, guildId: string): Promise<XpSettingsRow | null> {
  return db.prepare(`SELECT * FROM xp_settings WHERE guild_id = ?1`).bind(guildId).first<XpSettingsRow>();
}

export async function upsertXpSettings(
  db: D1Database,
  guildId: string,
  s: {
    enabled: boolean;
    xpMin: number;
    xpMax: number;
    cooldownSeconds: number;
    announceLevelUp: boolean;
    announceChannelId: string | null;
    rewards: Array<{ level: number; roleId: string }>;
    voiceEnabled: boolean;
    voiceXpPerMin: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO xp_settings (guild_id, enabled, xp_min, xp_max, cooldown_seconds, announce_level_up, announce_channel_id, rewards, voice_enabled, voice_xp_per_min)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = ?2, xp_min = ?3, xp_max = ?4, cooldown_seconds = ?5,
         announce_level_up = ?6, announce_channel_id = ?7, rewards = ?8,
         voice_enabled = ?9, voice_xp_per_min = ?10,
         updated_at = datetime('now')`,
    )
    .bind(
      guildId,
      s.enabled ? 1 : 0,
      s.xpMin,
      s.xpMax,
      s.cooldownSeconds,
      s.announceLevelUp ? 1 : 0,
      s.announceChannelId,
      JSON.stringify(s.rewards),
      s.voiceEnabled ? 1 : 0,
      s.voiceXpPerMin,
    )
    .run();
}

export interface XpMemberRow {
  guild_id: string;
  user_id: string;
  username: string | null;
  xp: number;
  level: number;
  messages: number;
  voice_minutes: number;
}

/** Adds XP (upsert) and returns the member's new totals. */
export async function grantXp(
  db: D1Database,
  guildId: string,
  userId: string,
  username: string | null,
  amount: number,
): Promise<XpMemberRow> {
  const row = await db
    .prepare(
      `INSERT INTO xp_members (guild_id, user_id, username, xp, messages, last_xp_at)
       VALUES (?1, ?2, ?3, ?4, 1, datetime('now'))
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         xp = xp + ?4, messages = messages + 1, username = COALESCE(?3, username), last_xp_at = datetime('now')
       RETURNING *`,
    )
    .bind(guildId, userId, username, amount)
    .first<XpMemberRow>();
  return row!;
}

/** Adds voice XP + voice minutes (upsert), without touching the message count. */
export async function grantVoiceXp(
  db: D1Database,
  guildId: string,
  userId: string,
  username: string | null,
  amount: number,
  minutes: number,
): Promise<XpMemberRow> {
  const row = await db
    .prepare(
      `INSERT INTO xp_members (guild_id, user_id, username, xp, voice_minutes, last_xp_at)
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         xp = xp + ?4, voice_minutes = voice_minutes + ?5, username = COALESCE(?3, username), last_xp_at = datetime('now')
       RETURNING *`,
    )
    .bind(guildId, userId, username, amount, minutes)
    .first<XpMemberRow>();
  return row!;
}

export async function setXpLevel(db: D1Database, guildId: string, userId: string, level: number): Promise<void> {
  await db.prepare(`UPDATE xp_members SET level = ?3 WHERE guild_id = ?1 AND user_id = ?2`).bind(guildId, userId, level).run();
}

export async function getXpMember(db: D1Database, guildId: string, userId: string): Promise<XpMemberRow | null> {
  return db.prepare(`SELECT * FROM xp_members WHERE guild_id = ?1 AND user_id = ?2`).bind(guildId, userId).first<XpMemberRow>();
}

export async function listXpLeaderboard(db: D1Database, guildId: string, limit: number): Promise<XpMemberRow[]> {
  return (
    await db
      .prepare(`SELECT * FROM xp_members WHERE guild_id = ?1 ORDER BY xp DESC LIMIT ?2`)
      .bind(guildId, limit)
      .all<XpMemberRow>()
  ).results;
}

/** 1-based leaderboard position for a given XP total. */
export async function xpRank(db: D1Database, guildId: string, xp: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS above FROM xp_members WHERE guild_id = ?1 AND xp > ?2`)
    .bind(guildId, xp)
    .first<{ above: number }>();
  return (row?.above ?? 0) + 1;
}

// --- Starboard (M23) -------------------------------------------------------

export interface StarboardSettingsRow {
  guild_id: string;
  enabled: number;
  channel_id: string | null;
  threshold: number;
  emoji: string;
}

export async function getStarboardSettings(db: D1Database, guildId: string): Promise<StarboardSettingsRow | null> {
  return db.prepare(`SELECT * FROM starboard_settings WHERE guild_id = ?1`).bind(guildId).first<StarboardSettingsRow>();
}

export async function upsertStarboardSettings(
  db: D1Database,
  guildId: string,
  s: { enabled: boolean; channelId: string | null; threshold: number; emoji: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO starboard_settings (guild_id, enabled, channel_id, threshold, emoji)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = ?2, channel_id = ?3, threshold = ?4, emoji = ?5, updated_at = datetime('now')`,
    )
    .bind(guildId, s.enabled ? 1 : 0, s.channelId, s.threshold, s.emoji)
    .run();
}

export interface StarboardPostRow {
  guild_id: string;
  message_id: string;
  channel_id: string;
  starboard_message_id: string | null;
  star_count: number;
}

export async function getStarboardPost(db: D1Database, guildId: string, messageId: string): Promise<StarboardPostRow | null> {
  return db
    .prepare(`SELECT * FROM starboard_posts WHERE guild_id = ?1 AND message_id = ?2`)
    .bind(guildId, messageId)
    .first<StarboardPostRow>();
}

export async function upsertStarboardPost(
  db: D1Database,
  guildId: string,
  messageId: string,
  channelId: string,
  starboardMessageId: string | null,
  starCount: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO starboard_posts (guild_id, message_id, channel_id, starboard_message_id, star_count)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(guild_id, message_id) DO UPDATE SET starboard_message_id = ?4, star_count = ?5`,
    )
    .bind(guildId, messageId, channelId, starboardMessageId, starCount)
    .run();
}

export async function deleteStarboardPost(db: D1Database, guildId: string, messageId: string): Promise<void> {
  await db.prepare(`DELETE FROM starboard_posts WHERE guild_id = ?1 AND message_id = ?2`).bind(guildId, messageId).run();
}

// ---------------------------------------------------------------------------
// Playlists (M14)
// ---------------------------------------------------------------------------

export interface PlaylistRow {
  id: number;
  guild_id: string;
  owner_id: string;
  name: string;
  tracks: string;
  created_at: string;
}

export async function upsertPlaylist(
  db: D1Database,
  guildId: string,
  ownerId: string,
  name: string,
  tracksJson: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO playlists (guild_id, owner_id, name, tracks) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(guild_id, name) DO UPDATE SET owner_id = ?2, tracks = ?4, created_at = datetime('now')`,
    )
    .bind(guildId, ownerId, name, tracksJson)
    .run();
}

export async function getPlaylist(db: D1Database, guildId: string, name: string): Promise<PlaylistRow | null> {
  return db.prepare(`SELECT * FROM playlists WHERE guild_id = ?1 AND name = ?2`).bind(guildId, name).first<PlaylistRow>();
}

export async function listPlaylists(db: D1Database, guildId: string): Promise<PlaylistRow[]> {
  return (
    await db.prepare(`SELECT * FROM playlists WHERE guild_id = ?1 ORDER BY name`).bind(guildId).all<PlaylistRow>()
  ).results;
}

export async function deletePlaylist(db: D1Database, guildId: string, name: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM playlists WHERE guild_id = ?1 AND name = ?2`).bind(guildId, name).run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Button roles
// ---------------------------------------------------------------------------

export interface ButtonRoleMessageRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  title: string;
  description: string | null;
  created_at: string;
}

export interface ButtonRoleRow {
  id: number;
  message_ref: number;
  guild_id: string;
  role_id: string;
  label: string;
  emoji: string | null;
  style: number;
  position: number;
}

export async function insertButtonRoleMessage(
  db: D1Database,
  msg: { guildId: string; channelId: string; title: string; description: string | null },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO button_role_messages (guild_id, channel_id, title, description)
       VALUES (?1, ?2, ?3, ?4) RETURNING id`,
    )
    .bind(msg.guildId, msg.channelId, msg.title, msg.description)
    .first<{ id: number }>();
  return row!.id;
}

export async function insertButtonRole(
  db: D1Database,
  btn: { messageRef: number; guildId: string; roleId: string; label: string; emoji: string | null; style: number; position: number },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO button_roles (message_ref, guild_id, role_id, label, emoji, style, position)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
    )
    .bind(btn.messageRef, btn.guildId, btn.roleId, btn.label, btn.emoji, btn.style, btn.position)
    .first<{ id: number }>();
  return row!.id;
}

export async function setButtonRoleMessageId(db: D1Database, id: number, messageId: string): Promise<void> {
  await db.prepare(`UPDATE button_role_messages SET message_id = ?2 WHERE id = ?1`).bind(id, messageId).run();
}

export async function getButtonRole(db: D1Database, id: number): Promise<ButtonRoleRow | null> {
  return db.prepare(`SELECT * FROM button_roles WHERE id = ?1`).bind(id).first<ButtonRoleRow>();
}

export async function listButtonRoleMessages(db: D1Database, guildId: string): Promise<ButtonRoleMessageRow[]> {
  return (
    await db
      .prepare(`SELECT * FROM button_role_messages WHERE guild_id = ?1 ORDER BY created_at DESC`)
      .bind(guildId)
      .all<ButtonRoleMessageRow>()
  ).results;
}

export async function getButtonRoleMessage(db: D1Database, guildId: string, id: number): Promise<ButtonRoleMessageRow | null> {
  return db
    .prepare(`SELECT * FROM button_role_messages WHERE guild_id = ?1 AND id = ?2`)
    .bind(guildId, id)
    .first<ButtonRoleMessageRow>();
}

export async function listButtonRolesForMessage(db: D1Database, messageRef: number): Promise<ButtonRoleRow[]> {
  return (
    await db
      .prepare(`SELECT * FROM button_roles WHERE message_ref = ?1 ORDER BY position, id`)
      .bind(messageRef)
      .all<ButtonRoleRow>()
  ).results;
}

export async function deleteButtonRoleMessage(db: D1Database, guildId: string, id: number): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM button_roles WHERE message_ref = ?1 AND guild_id = ?2`).bind(id, guildId),
    db.prepare(`DELETE FROM button_role_messages WHERE id = ?1 AND guild_id = ?2`).bind(id, guildId),
  ]);
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export interface TicketSettingsRow {
  guild_id: string;
  enabled: number;
  category_id: string | null;
  panel_channel_id: string | null;
  panel_message_id: string | null;
  staff_role_ids: string;
  transcript_channel_id: string | null;
  next_number: number;
  updated_at: string | null;
}

export interface TicketRow {
  id: number;
  guild_id: string;
  number: number;
  channel_id: string;
  user_id: string;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: string | null;
  transcript: string | null;
}

export async function getTicketSettings(db: D1Database, guildId: string): Promise<TicketSettingsRow | null> {
  return db.prepare(`SELECT * FROM ticket_settings WHERE guild_id = ?1`).bind(guildId).first<TicketSettingsRow>();
}

export async function upsertTicketSettings(
  db: D1Database,
  guildId: string,
  settings: { enabled: boolean; categoryId: string | null; staffRoleIds: string[]; transcriptChannelId: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ticket_settings (guild_id, enabled, category_id, staff_role_ids, transcript_channel_id, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = excluded.enabled,
         category_id = excluded.category_id,
         staff_role_ids = excluded.staff_role_ids,
         transcript_channel_id = excluded.transcript_channel_id,
         updated_at = datetime('now')`,
    )
    .bind(guildId, settings.enabled ? 1 : 0, settings.categoryId, JSON.stringify(settings.staffRoleIds), settings.transcriptChannelId)
    .run();
}

export async function setTicketPanelMessage(db: D1Database, guildId: string, channelId: string, messageId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ticket_settings (guild_id, panel_channel_id, panel_message_id, updated_at)
       VALUES (?1, ?2, ?3, datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         panel_channel_id = excluded.panel_channel_id,
         panel_message_id = excluded.panel_message_id,
         updated_at = datetime('now')`,
    )
    .bind(guildId, channelId, messageId)
    .run();
}

/** Reserves the next ticket number (atomic increment). Null when settings are missing. */
export async function allocateTicketNumber(db: D1Database, guildId: string): Promise<number | null> {
  const row = await db
    .prepare(`UPDATE ticket_settings SET next_number = next_number + 1 WHERE guild_id = ?1 RETURNING next_number - 1 AS n`)
    .bind(guildId)
    .first<{ n: number }>();
  return row?.n ?? null;
}

export async function insertTicket(
  db: D1Database,
  ticket: { guildId: string; number: number; channelId: string; userId: string },
): Promise<number> {
  const row = await db
    .prepare(`INSERT INTO tickets (guild_id, number, channel_id, user_id) VALUES (?1, ?2, ?3, ?4) RETURNING id`)
    .bind(ticket.guildId, ticket.number, ticket.channelId, ticket.userId)
    .first<{ id: number }>();
  return row!.id;
}

export async function getOpenTicketForUser(db: D1Database, guildId: string, userId: string): Promise<TicketRow | null> {
  return db
    .prepare(`SELECT * FROM tickets WHERE guild_id = ?1 AND user_id = ?2 AND status = 'open' LIMIT 1`)
    .bind(guildId, userId)
    .first<TicketRow>();
}

export async function getTicketByChannel(db: D1Database, channelId: string): Promise<TicketRow | null> {
  return db.prepare(`SELECT * FROM tickets WHERE channel_id = ?1`).bind(channelId).first<TicketRow>();
}

export async function getTicketById(db: D1Database, guildId: string, id: number): Promise<TicketRow | null> {
  return db.prepare(`SELECT * FROM tickets WHERE guild_id = ?1 AND id = ?2`).bind(guildId, id).first<TicketRow>();
}

export async function closeTicket(
  db: D1Database,
  id: number,
  closedBy: string,
  reason: string | null,
  transcript: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE tickets SET status = 'closed', closed_at = datetime('now'), closed_by = ?2, close_reason = ?3, transcript = ?4
       WHERE id = ?1 AND status = 'open'`,
    )
    .bind(id, closedBy, reason, transcript)
    .run();
  return res.meta.changes > 0;
}

export async function listTickets(
  db: D1Database,
  guildId: string,
  opts: { page: number; pageSize: number; status?: "open" | "closed" },
): Promise<{ rows: TicketRow[]; total: number }> {
  const where: string[] = ["guild_id = ?1"];
  const binds: unknown[] = [guildId];
  if (opts.status) {
    binds.push(opts.status);
    where.push(`status = ?${binds.length}`);
  }
  const whereSql = where.join(" AND ");
  const total =
    (await db
      .prepare(`SELECT COUNT(*) AS n FROM tickets WHERE ${whereSql}`)
      .bind(...binds)
      .first<{ n: number }>())?.n ?? 0;
  const limit = Math.min(Math.max(opts.pageSize, 1), 100);
  const offset = Math.max(opts.page - 1, 0) * limit;
  const rows = await db
    .prepare(`SELECT * FROM tickets WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`)
    .bind(...binds)
    .all<TicketRow>();
  return { rows: rows.results, total };
}
