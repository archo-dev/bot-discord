/** Client support storage (M11). Raw SQL only. Everything is scoped to the
 * ticket owner (user_id); internal messages and the operator assignee are never
 * selected for the client. Priority is written once at open (frozen). No
 * physical deletion — status transitions only. */

import type { PlanId, SupportPriority, SupportTicketStatus } from "@bot/shared";

export interface SupportTicketRow {
  id: number;
  user_id: string;
  guild_id: string | null;
  plan_at_open: string;
  priority: string;
  subject: string;
  status: string;
  assignee: string | null;
  plan_changed_since_open: number;
  created_at: string;
  updated_at: string;
}

export interface SupportMessageRow {
  id: number;
  ticket_id: number;
  author: string;
  body: string;
  internal: number;
  created_at: string;
}

const TICKET_COLUMNS = `id, user_id, guild_id, plan_at_open, priority, subject, status,
  assignee, plan_changed_since_open, created_at, updated_at`;

export interface InsertSupportTicketInput {
  userId: string;
  guildId?: string | null;
  planAtOpen: PlanId;
  priority: SupportPriority;
  subject: string;
}

export async function insertSupportTicket(db: D1Database, input: InsertSupportTicketInput): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO support_tickets (user_id, guild_id, plan_at_open, priority, subject)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(input.userId, input.guildId ?? null, input.planAtOpen, input.priority, input.subject)
    .run();
  return Number(res.meta.last_row_id);
}

export interface InsertSupportMessageInput {
  ticketId: number;
  author: string;
  body: string;
  internal?: boolean;
}

export async function insertSupportMessage(db: D1Database, input: InsertSupportMessageInput): Promise<void> {
  await db
    .prepare(`INSERT INTO support_messages (ticket_id, author, body, internal) VALUES (?1, ?2, ?3, ?4)`)
    .bind(input.ticketId, input.author, input.body, input.internal ? 1 : 0)
    .run();
}

/** A ticket by id, only if owned by `userId` (isolation). */
export async function getTicketForUser(db: D1Database, id: number, userId: string): Promise<SupportTicketRow | null> {
  const row = await db
    .prepare(`SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE id = ?1 AND user_id = ?2`)
    .bind(id, userId)
    .first<SupportTicketRow>();
  return row ?? null;
}

export interface TicketListResult {
  rows: SupportTicketRow[];
  total: number;
}

/** The user's own tickets, newest activity first. */
export async function listUserTickets(db: D1Database, userId: string, page: number, pageSize: number): Promise<TicketListResult> {
  const offset = (page - 1) * pageSize;
  const results = await db.batch<SupportTicketRow | { n: number }>([
    db
      .prepare(`SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE user_id = ?1 ORDER BY updated_at DESC, id DESC LIMIT ?2 OFFSET ?3`)
      .bind(userId, pageSize, offset),
    db.prepare(`SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ?1`).bind(userId),
  ]);
  return {
    rows: (results[0]?.results ?? []) as SupportTicketRow[],
    total: ((results[1]?.results?.[0] as { n: number } | undefined)?.n) ?? 0,
  };
}

/** Non-internal messages of a ticket, oldest first (client-visible only). */
export async function listClientMessages(db: D1Database, ticketId: number): Promise<SupportMessageRow[]> {
  const res = await db
    .prepare(`SELECT id, ticket_id, author, body, internal, created_at FROM support_messages
              WHERE ticket_id = ?1 AND internal = 0 ORDER BY created_at ASC, id ASC`)
    .bind(ticketId)
    .all<SupportMessageRow>();
  return res.results ?? [];
}

/** Update a ticket's status for its owner. Returns true if a row changed. */
export async function updateTicketStatusForUser(
  db: D1Database,
  id: number,
  userId: string,
  status: SupportTicketStatus,
): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE support_tickets SET status = ?3, updated_at = datetime('now') WHERE id = ?1 AND user_id = ?2`)
    .bind(id, userId, status)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function bumpTicketUpdatedAt(db: D1Database, id: number): Promise<void> {
  await db.prepare(`UPDATE support_tickets SET updated_at = datetime('now') WHERE id = ?1`).bind(id).run();
}

/**
 * Priority queue (consumed by the Studio in M12): highest priority first, then
 * oldest first at equal priority (anti-starvation). Provided + tested in M11.
 */
export async function listSupportQueue(
  db: D1Database,
  page: number,
  pageSize: number,
  status?: SupportTicketStatus,
): Promise<TicketListResult> {
  const offset = (page - 1) * pageSize;
  const where = status ? `WHERE status = ?3` : ``;
  const order = `ORDER BY CASE priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC, created_at ASC, id ASC`;
  const listStmt = db
    .prepare(`SELECT ${TICKET_COLUMNS} FROM support_tickets ${where} ${order} LIMIT ?1 OFFSET ?2`)
    .bind(...(status ? [pageSize, offset, status] : [pageSize, offset]));
  const countStmt = db
    .prepare(`SELECT COUNT(*) AS n FROM support_tickets ${status ? `WHERE status = ?1` : ``}`)
    .bind(...(status ? [status] : []));
  const results = await db.batch<SupportTicketRow | { n: number }>([listStmt, countStmt]);
  return {
    rows: (results[0]?.results ?? []) as SupportTicketRow[],
    total: ((results[1]?.results?.[0] as { n: number } | undefined)?.n) ?? 0,
  };
}
