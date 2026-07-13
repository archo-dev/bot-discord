/** Ticket system (M8): settings, atomic numbering, lifecycle + transcripts. */
import { syncGuildModuleStatement } from "./modules.js";

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
  const settingsStatement = db.prepare(
      `INSERT INTO ticket_settings (guild_id, enabled, category_id, staff_role_ids, transcript_channel_id, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = excluded.enabled,
         category_id = excluded.category_id,
         staff_role_ids = excluded.staff_role_ids,
         transcript_channel_id = excluded.transcript_channel_id,
         updated_at = datetime('now')`,
    )
    .bind(guildId, settings.enabled ? 1 : 0, settings.categoryId, JSON.stringify(settings.staffRoleIds), settings.transcriptChannelId);
  await db.batch([settingsStatement, syncGuildModuleStatement(db, guildId, "tickets", settings.enabled)]);
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
