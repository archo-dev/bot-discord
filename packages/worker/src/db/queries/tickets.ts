/** Ticket system: legacy lifecycle plus bounded M09 team triage. */
import type { TicketFormConfig, TicketPriority, TicketState } from "@bot/shared";
import { subscribedAutomationEventStatement } from "./automations.js";
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
  form_enabled: number;
  form_config: string | null;
}

export interface TicketRow {
  id: number;
  guild_id: string;
  number: number;
  channel_id: string;
  user_id: string;
  status: "open" | "closed";
  state: TicketState;
  priority: TicketPriority;
  category_key: string | null;
  assignee_id: string | null;
  assigned_at: string | null;
  updated_at: string | null;
  form_response: string | null;
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: string | null;
  transcript: string | null;
}

export interface TicketEventRow {
  id: number;
  guild_id: string;
  ticket_id: number;
  type: "created" | "assigned" | "unassigned" | "state_changed" | "priority_changed" | "closed";
  actor_id: string;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}

export async function getTicketSettings(db: D1Database, guildId: string): Promise<TicketSettingsRow | null> {
  return db.prepare(`SELECT * FROM ticket_settings WHERE guild_id = ?1`).bind(guildId).first<TicketSettingsRow>();
}

export async function upsertTicketSettings(
  db: D1Database,
  guildId: string,
  settings: {
    enabled: boolean;
    categoryId: string | null;
    staffRoleIds: string[];
    transcriptChannelId: string | null;
    formEnabled?: boolean;
    form?: TicketFormConfig;
  },
): Promise<void> {
  const settingsStatement = db.prepare(
      `INSERT INTO ticket_settings
         (guild_id, enabled, category_id, staff_role_ids, transcript_channel_id, form_enabled, form_config, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = excluded.enabled,
         category_id = excluded.category_id,
         staff_role_ids = excluded.staff_role_ids,
         transcript_channel_id = excluded.transcript_channel_id,
         form_enabled = excluded.form_enabled,
         form_config = excluded.form_config,
         updated_at = datetime('now')`,
    )
    .bind(
      guildId,
      settings.enabled ? 1 : 0,
      settings.categoryId,
      JSON.stringify(settings.staffRoleIds),
      settings.transcriptChannelId,
      settings.formEnabled ? 1 : 0,
      settings.form ? JSON.stringify(settings.form) : null,
    );
  await db.batch([settingsStatement, syncGuildModuleStatement(db, guildId, "tickets", settings.enabled)]);
}

export async function setTicketPanelMessage(db: D1Database, guildId: string, channelId: string, messageId: string): Promise<void> {
  await db.prepare(
    `INSERT INTO ticket_settings (guild_id, panel_channel_id, panel_message_id, updated_at)
     VALUES (?1, ?2, ?3, datetime('now'))
     ON CONFLICT(guild_id) DO UPDATE SET
       panel_channel_id = excluded.panel_channel_id,
       panel_message_id = excluded.panel_message_id,
       updated_at = datetime('now')`,
  ).bind(guildId, channelId, messageId).run();
}

/** Reserves the next ticket number (atomic increment). Null when settings are missing. */
export async function allocateTicketNumber(db: D1Database, guildId: string): Promise<number | null> {
  const row = await db.prepare(
    `UPDATE ticket_settings SET next_number = next_number + 1 WHERE guild_id = ?1 RETURNING next_number - 1 AS n`,
  ).bind(guildId).first<{ n: number }>();
  return row?.n ?? null;
}

/** Legacy/test helper. New interactions use reserveTicket before Discord REST. */
export async function insertTicket(
  db: D1Database,
  ticket: {
    guildId: string;
    number: number;
    channelId: string;
    userId: string;
    categoryKey?: string | null;
    formResponse?: Record<string, string> | null;
  },
): Promise<number> {
  const row = await db.prepare(
    `INSERT INTO tickets
       (guild_id, number, channel_id, user_id, category_key, form_response, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now')) RETURNING id`,
  ).bind(
    ticket.guildId,
    ticket.number,
    ticket.channelId,
    ticket.userId,
    ticket.categoryKey ?? null,
    ticket.formResponse ? JSON.stringify(ticket.formResponse) : null,
  ).first<{ id: number }>();
  return row!.id;
}

export interface ReservedTicket { id: number; number: number; placeholderChannelId: string }

/** Durable single-opener claim acquired before any Discord channel is created. */
export async function reserveTicket(
  db: D1Database,
  input: { guildId: string; userId: string; categoryKey: string | null; formResponse: Record<string, string> | null },
): Promise<ReservedTicket | null> {
  // Recover a claim left before ticket insertion by an abruptly terminated
  // Worker, or a claim whose linked ticket is no longer active.
  await db.prepare(
    `DELETE FROM ticket_open_claims
     WHERE guild_id = ?1 AND user_id = ?2 AND (
       (ticket_id IS NULL AND created_at < datetime('now', '-10 minutes')) OR
       (ticket_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM tickets WHERE tickets.id = ticket_open_claims.ticket_id AND tickets.status = 'open'
       ))
     )`,
  ).bind(input.guildId, input.userId).run();
  const claim = await db.prepare(
    `INSERT OR IGNORE INTO ticket_open_claims (guild_id, user_id) VALUES (?1, ?2)`,
  ).bind(input.guildId, input.userId).run();
  if (claim.meta.changes === 0) return null;

  let ticketId: number | null = null;
  try {
    const number = await allocateTicketNumber(db, input.guildId);
    if (number === null) throw new Error("ticket settings missing during reservation");
    const placeholderChannelId = `pending:${crypto.randomUUID()}`;
    ticketId = await insertTicket(db, {
      guildId: input.guildId,
      number,
      channelId: placeholderChannelId,
      userId: input.userId,
      categoryKey: input.categoryKey,
      formResponse: input.formResponse,
    });
    await db.batch([
      db.prepare(`UPDATE ticket_open_claims SET ticket_id = ?3 WHERE guild_id = ?1 AND user_id = ?2`)
        .bind(input.guildId, input.userId, ticketId),
      db.prepare(
        `INSERT INTO ticket_events (guild_id, ticket_id, type, actor_id, to_value)
         VALUES (?1, ?2, 'created', ?3, ?4)`,
      ).bind(input.guildId, ticketId, input.userId, input.categoryKey),
    ]);
    return { id: ticketId, number, placeholderChannelId };
  } catch (error) {
    if (ticketId !== null) await db.prepare(`DELETE FROM tickets WHERE id = ?1`).bind(ticketId).run();
    await db.prepare(`DELETE FROM ticket_open_claims WHERE guild_id = ?1 AND user_id = ?2`)
      .bind(input.guildId, input.userId).run();
    throw error;
  }
}

export async function finalizeTicketChannel(
  db: D1Database,
  guildId: string,
  ticketId: number,
  placeholder: string,
  channelId: string,
): Promise<boolean> {
  const ticket = await db.prepare(
    `SELECT user_id, category_key FROM tickets
     WHERE guild_id = ?1 AND id = ?2 AND channel_id = ?3 AND status = 'open'`,
  ).bind(guildId, ticketId, placeholder).first<{ user_id: string; category_key: string | null }>();
  if (!ticket) return false;
  const eventId = `ticket-open:${ticketId}:${channelId}`;
  const results = await db.batch([
    db.prepare(
      `UPDATE tickets SET channel_id = ?4, updated_at = datetime('now')
       WHERE guild_id = ?1 AND id = ?2 AND channel_id = ?3 AND status = 'open'`,
    ).bind(guildId, ticketId, placeholder, channelId),
    subscribedAutomationEventStatement(db, {
      id: eventId,
      guildId,
      triggerType: "ticket_opened",
      context: {
        event: { type: "ticket_opened", id: eventId, depth: 0 },
        guild: { id: guildId },
        user: { id: ticket.user_id },
        channel: { id: channelId },
        ticket: { id: ticketId, channelId },
      },
      enabled: ticket.category_key !== "automation",
      requirePreviousChange: true,
    }),
  ]);
  return results[0]!.meta.changes > 0;
}

export async function cancelTicketReservation(db: D1Database, ticketId: number, guildId: string, userId: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM ticket_open_claims WHERE guild_id = ?1 AND user_id = ?2 AND ticket_id = ?3`)
      .bind(guildId, userId, ticketId),
    db.prepare(`DELETE FROM tickets WHERE id = ?1 AND guild_id = ?2 AND user_id = ?3 AND status = 'open'`)
      .bind(ticketId, guildId, userId),
  ]);
}

export async function getOpenTicketForUser(db: D1Database, guildId: string, userId: string): Promise<TicketRow | null> {
  return db.prepare(
    `SELECT * FROM tickets WHERE guild_id = ?1 AND user_id = ?2 AND status = 'open' ORDER BY id LIMIT 1`,
  ).bind(guildId, userId).first<TicketRow>();
}

export async function getTicketByChannel(db: D1Database, guildId: string, channelId: string): Promise<TicketRow | null> {
  return db.prepare(`SELECT * FROM tickets WHERE guild_id = ?1 AND channel_id = ?2`).bind(guildId, channelId).first<TicketRow>();
}

export async function getTicketById(db: D1Database, guildId: string, id: number): Promise<TicketRow | null> {
  return db.prepare(`SELECT * FROM tickets WHERE guild_id = ?1 AND id = ?2`).bind(guildId, id).first<TicketRow>();
}

export async function closeTicket(
  db: D1Database,
  guildId: string,
  id: number,
  closedBy: string,
  reason: string | null,
  transcript: string,
): Promise<boolean> {
  const current = await db.prepare(`SELECT guild_id, user_id, channel_id FROM tickets WHERE guild_id = ?1 AND id = ?2 AND status = 'open'`)
    .bind(guildId, id).first<{ guild_id: string; user_id: string; channel_id: string }>();
  if (!current) return false;
  const eventId = `ticket-close:${id}:${crypto.randomUUID()}`;
  const results = await db.batch([
    db.prepare(
      `UPDATE tickets SET status = 'closed', state = 'closed', closed_at = datetime('now'), updated_at = datetime('now'),
         closed_by = ?3, close_reason = ?4,
         transcript = CASE WHEN transcript IS NULL THEN ?5
           ELSE transcript || '\n\n--- Nouvelle période après réouverture ---\n\n' || ?5 END
       WHERE guild_id = ?1 AND id = ?2 AND status = 'open'`,
    ).bind(guildId, id, closedBy, reason, transcript),
    subscribedAutomationEventStatement(db, {
      id: eventId,
      guildId,
      triggerType: "ticket_closed",
      context: {
        event: { type: "ticket_closed", id: eventId, depth: 0 },
        guild: { id: guildId },
        user: { id: current.user_id },
        channel: { id: current.channel_id },
        ticket: { id, channelId: current.channel_id },
        reason: reason ?? "",
      },
      enabled: closedBy !== "automation",
      requirePreviousChange: true,
    }),
    db.prepare(`DELETE FROM ticket_open_claims WHERE guild_id = ?1 AND user_id = ?2 AND ticket_id = ?3`)
      .bind(current.guild_id, current.user_id, id),
    db.prepare(
      `INSERT INTO ticket_events (guild_id, ticket_id, type, actor_id, to_value)
       SELECT ?1, ?2, 'closed', ?3, 'closed'
       WHERE EXISTS (SELECT 1 FROM tickets WHERE guild_id = ?1 AND id = ?2 AND status = 'closed' AND closed_by = ?3)
         AND NOT EXISTS (
           SELECT 1 FROM ticket_events
           WHERE guild_id = ?1 AND ticket_id = ?2 AND type = 'closed'
             AND id > COALESCE((
               SELECT MAX(id) FROM ticket_events
               WHERE guild_id = ?1 AND ticket_id = ?2 AND type = 'state_changed'
                 AND from_value = 'closed' AND to_value = 'open'
             ), 0)
         )`,
    ).bind(current.guild_id, id, closedBy),
    db.prepare(
      `DELETE FROM ticket_events WHERE guild_id = ?1 AND ticket_id = ?2 AND id NOT IN
       (SELECT id FROM ticket_events WHERE guild_id = ?1 AND ticket_id = ?2 ORDER BY created_at DESC, id DESC LIMIT 100)`,
    ).bind(current.guild_id, id),
  ]);
  return results[0]!.meta.changes > 0;
}

/** Restores the active state when Discord refused to delete the channel after the D1 close. */
export async function compensateFailedTicketClose(
  db: D1Database,
  ticket: Pick<TicketRow, "id" | "guild_id" | "user_id" | "state" | "transcript">,
): Promise<boolean> {
  const restored = await db.prepare(
    `UPDATE tickets SET status = 'open', state = ?3, closed_at = NULL, closed_by = NULL,
       close_reason = NULL, transcript = ?4, updated_at = datetime('now')
     WHERE guild_id = ?1 AND id = ?2 AND status = 'closed' RETURNING id`,
  ).bind(ticket.guild_id, ticket.id, ticket.state === "pending" ? "pending" : "open", ticket.transcript).first<{ id: number }>();
  if (!restored) return false;
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO ticket_open_claims (guild_id, user_id, ticket_id)
       VALUES (?1, ?2, ?3)`,
    ).bind(ticket.guild_id, ticket.user_id, ticket.id),
    db.prepare(
      `DELETE FROM ticket_events WHERE id = (
         SELECT id FROM ticket_events WHERE guild_id = ?1 AND ticket_id = ?2 AND type = 'closed' ORDER BY id DESC LIMIT 1
       )`,
    ).bind(ticket.guild_id, ticket.id),
    db.prepare(
      `DELETE FROM automation_event_queue WHERE id = (
         SELECT id FROM automation_event_queue
         WHERE guild_id = ?1 AND trigger_type = 'ticket_closed'
           AND instr(id, 'ticket-close:' || CAST(CAST(?2 AS INTEGER) AS TEXT) || ':') = 1 AND status = 'queued'
         ORDER BY created_at DESC LIMIT 1
       )`,
    ).bind(ticket.guild_id, ticket.id),
  ]);
  return true;
}

/** Acquires the user's single-active-ticket claim before a closed ticket is recreated on Discord. */
export async function reserveTicketReopen(
  db: D1Database,
  guildId: string,
  id: number,
): Promise<{ outcome: "reserved" | "conflict" | "not_found"; ticket: TicketRow | null }> {
  const ticket = await getTicketById(db, guildId, id);
  if (!ticket || ticket.status !== "closed") return { outcome: "not_found", ticket };
  await db.prepare(
    `DELETE FROM ticket_open_claims
     WHERE guild_id = ?1 AND user_id = ?2 AND (
       (ticket_id IS NULL AND created_at < datetime('now', '-10 minutes')) OR
       (ticket_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM tickets WHERE tickets.id = ticket_open_claims.ticket_id
           AND tickets.guild_id = ticket_open_claims.guild_id AND tickets.status = 'open'
       ))
     )`,
  ).bind(guildId, ticket.user_id).run();
  const claim = await db.prepare(
    `INSERT OR IGNORE INTO ticket_open_claims (guild_id, user_id, ticket_id)
     SELECT ?1, ?2, ?3 WHERE NOT EXISTS (
       SELECT 1 FROM tickets WHERE guild_id = ?1 AND user_id = ?2 AND status = 'open'
     )`,
  ).bind(guildId, ticket.user_id, id).run();
  return claim.meta.changes > 0
    ? { outcome: "reserved", ticket }
    : { outcome: "conflict", ticket };
}

/** Finalizes a reopened ticket only while its durable claim is still held. */
export async function finalizeTicketReopen(
  db: D1Database,
  guildId: string,
  id: number,
  actorId: string,
  channelId: string,
): Promise<TicketRow | null> {
  const pending = await getTicketById(db, guildId, id);
  if (!pending || pending.status !== "closed") return null;
  const eventId = `ticket-open:${id}:${channelId}`;
  const results = await db.batch([
    db.prepare(
      `UPDATE tickets SET channel_id = ?3, status = 'open', state = 'open', closed_at = NULL,
         closed_by = NULL, close_reason = NULL, updated_at = datetime('now')
       WHERE guild_id = ?1 AND id = ?2 AND status = 'closed'
         AND EXISTS (SELECT 1 FROM ticket_open_claims
           WHERE guild_id = ?1 AND user_id = tickets.user_id AND ticket_id = ?2)`,
    ).bind(guildId, id, channelId),
    subscribedAutomationEventStatement(db, {
      id: eventId,
      guildId,
      triggerType: "ticket_opened",
      context: {
        event: { type: "ticket_opened", id: eventId, depth: 0 },
        guild: { id: guildId },
        user: { id: pending.user_id },
        channel: { id: channelId },
        ticket: { id, channelId },
      },
      enabled: pending.category_key !== "automation",
      requirePreviousChange: true,
    }),
    db.prepare(
      `INSERT INTO ticket_events (guild_id, ticket_id, type, actor_id, from_value, to_value)
       SELECT ?1, ?2, 'state_changed', ?3, 'closed', 'open'
       WHERE EXISTS (SELECT 1 FROM tickets WHERE guild_id = ?1 AND id = ?2 AND channel_id = ?4 AND status = 'open')`,
    ).bind(guildId, id, actorId, channelId),
    db.prepare(
      `DELETE FROM ticket_events WHERE guild_id = ?1 AND ticket_id = ?2 AND id NOT IN
       (SELECT id FROM ticket_events WHERE guild_id = ?1 AND ticket_id = ?2 ORDER BY created_at DESC, id DESC LIMIT 100)`,
    ).bind(guildId, id),
  ]);
  return results[0]!.meta.changes > 0 ? getTicketById(db, guildId, id) : null;
}

export async function cancelTicketReopen(db: D1Database, guildId: string, userId: string, id: number): Promise<void> {
  await db.prepare(
    `DELETE FROM ticket_open_claims WHERE guild_id = ?1 AND user_id = ?2 AND ticket_id = ?3
       AND EXISTS (SELECT 1 FROM tickets WHERE guild_id = ?1 AND id = ?3 AND status = 'closed')`,
  ).bind(guildId, userId, id).run();
}

export async function claimTicket(
  db: D1Database,
  guildId: string,
  id: number,
  actorId: string,
): Promise<{ outcome: "claimed" | "idempotent" | "conflict" | "not_found"; ticket: TicketRow | null }> {
  const claimed = await db.prepare(
    `UPDATE tickets SET assignee_id = ?3, assigned_at = COALESCE(assigned_at, datetime('now')), updated_at = datetime('now')
     WHERE guild_id = ?1 AND id = ?2 AND state <> 'closed' AND assignee_id IS NULL RETURNING *`,
  ).bind(guildId, id, actorId).first<TicketRow>();
  if (claimed) {
    await addTicketEvent(db, guildId, id, "assigned", actorId, null, actorId);
    return { outcome: "claimed", ticket: claimed };
  }
  const current = await getTicketById(db, guildId, id);
  if (!current || current.state === "closed") return { outcome: "not_found", ticket: current };
  return { outcome: current.assignee_id === actorId ? "idempotent" : "conflict", ticket: current };
}

export async function unassignTicket(db: D1Database, guildId: string, id: number, actorId: string): Promise<TicketRow | null> {
  const previous = await getTicketById(db, guildId, id);
  if (!previous || previous.state === "closed") return null;
  if (!previous.assignee_id) return previous;
  const updated = await db.prepare(
    `UPDATE tickets SET assignee_id = NULL, assigned_at = NULL, updated_at = datetime('now')
     WHERE guild_id = ?1 AND id = ?2 AND state <> 'closed' RETURNING *`,
  ).bind(guildId, id).first<TicketRow>();
  if (updated) await addTicketEvent(db, guildId, id, "unassigned", actorId, previous.assignee_id, null);
  return updated;
}

export async function setTicketState(
  db: D1Database,
  guildId: string,
  id: number,
  actorId: string,
  state: "open" | "pending",
): Promise<TicketRow | null> {
  const previous = await getTicketById(db, guildId, id);
  if (!previous || previous.state === "closed") return null;
  if (previous.state === state) return previous;
  const updated = await db.prepare(
    `UPDATE tickets SET state = ?3, status = 'open', updated_at = datetime('now')
     WHERE guild_id = ?1 AND id = ?2 AND state <> 'closed' RETURNING *`,
  ).bind(guildId, id, state).first<TicketRow>();
  if (updated) await addTicketEvent(db, guildId, id, "state_changed", actorId, previous.state, state);
  return updated;
}

export async function setTicketPriority(
  db: D1Database,
  guildId: string,
  id: number,
  actorId: string,
  priority: TicketPriority,
): Promise<TicketRow | null> {
  const previous = await getTicketById(db, guildId, id);
  if (!previous || previous.state === "closed") return null;
  if (previous.priority === priority) return previous;
  const updated = await db.prepare(
    `UPDATE tickets SET priority = ?3, updated_at = datetime('now')
     WHERE guild_id = ?1 AND id = ?2 AND state <> 'closed' RETURNING *`,
  ).bind(guildId, id, priority).first<TicketRow>();
  if (updated) await addTicketEvent(db, guildId, id, "priority_changed", actorId, previous.priority, priority);
  return updated;
}

async function addTicketEvent(
  db: D1Database,
  guildId: string,
  ticketId: number,
  type: TicketEventRow["type"],
  actorId: string,
  fromValue: string | null,
  toValue: string | null,
): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO ticket_events (guild_id, ticket_id, type, actor_id, from_value, to_value)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(guildId, ticketId, type, actorId, fromValue, toValue),
    db.prepare(
      `DELETE FROM ticket_events WHERE ticket_id = ?1 AND id NOT IN
       (SELECT id FROM ticket_events WHERE ticket_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 100)`,
    ).bind(ticketId),
  ]);
}

export async function listTicketEvents(db: D1Database, guildId: string, ticketId: number): Promise<TicketEventRow[]> {
  const rows = await db.prepare(
    `SELECT * FROM ticket_events WHERE guild_id = ?1 AND ticket_id = ?2 ORDER BY created_at DESC, id DESC LIMIT 100`,
  ).bind(guildId, ticketId).all<TicketEventRow>();
  return rows.results;
}

export async function listTickets(
  db: D1Database,
  guildId: string,
  opts: { page: number; pageSize: number; state?: TicketState; priority?: TicketPriority; assigneeId?: string },
): Promise<{ rows: TicketRow[]; total: number }> {
  const where: string[] = ["guild_id = ?1"];
  const binds: unknown[] = [guildId];
  if (opts.state) { binds.push(opts.state); where.push(`state = ?${binds.length}`); }
  if (opts.priority) { binds.push(opts.priority); where.push(`priority = ?${binds.length}`); }
  if (opts.assigneeId) {
    if (opts.assigneeId === "unassigned") where.push("assignee_id IS NULL");
    else { binds.push(opts.assigneeId); where.push(`assignee_id = ?${binds.length}`); }
  }
  const whereSql = where.join(" AND ");
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM tickets WHERE ${whereSql}`)
    .bind(...binds).first<{ n: number }>())?.n ?? 0;
  const limit = Math.min(Math.max(opts.pageSize, 1), 100);
  const offset = Math.max(opts.page - 1, 0) * limit;
  const rows = await db.prepare(
    `SELECT * FROM tickets WHERE ${whereSql}
     ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END, created_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`,
  ).bind(...binds).all<TicketRow>();
  return { rows: rows.results, total };
}

export async function getTicketStats(db: D1Database, guildId: string): Promise<{
  total: number; open: number; pending: number; closed: number; unassigned: number;
  highPriority: number; aging: number; medianAssignMinutes: number | null;
  byCategory: Array<{ categoryKey: string; count: number }>;
}> {
  const counts = (await db.prepare(
    `SELECT COUNT(*) total,
       SUM(state = 'open') open, SUM(state = 'pending') pending, SUM(state = 'closed') closed,
       SUM(state <> 'closed' AND assignee_id IS NULL) unassigned,
       SUM(state <> 'closed' AND priority = 'high') high_priority,
       SUM(state <> 'closed' AND created_at <= datetime('now', '-24 hours')) aging
     FROM tickets WHERE guild_id = ?1`,
  ).bind(guildId).first<Record<string, number>>())!;
  const categories = await db.prepare(
    `SELECT COALESCE(category_key, 'legacy') category_key, COUNT(*) count
     FROM tickets WHERE guild_id = ?1 GROUP BY COALESCE(category_key, 'legacy') ORDER BY count DESC LIMIT 10`,
  ).bind(guildId).all<{ category_key: string; count: number }>();
  const durations = await db.prepare(
    `SELECT CAST((julianday(assigned_at) - julianday(created_at)) * 1440 AS INTEGER) minutes
     FROM tickets WHERE guild_id = ?1 AND assigned_at IS NOT NULL
       AND created_at >= datetime('now', '-90 days') ORDER BY minutes LIMIT 1000`,
  ).bind(guildId).all<{ minutes: number }>();
  const values = durations.results.map((row) => Math.max(row.minutes, 0));
  const mid = Math.floor(values.length / 2);
  const medianAssignMinutes = values.length === 0 ? null
    : values.length % 2 === 1 ? values[mid]! : Math.round((values[mid - 1]! + values[mid]!) / 2);
  return {
    total: counts.total ?? 0,
    open: counts.open ?? 0,
    pending: counts.pending ?? 0,
    closed: counts.closed ?? 0,
    unassigned: counts.unassigned ?? 0,
    highPriority: counts.high_priority ?? 0,
    aging: counts.aging ?? 0,
    medianAssignMinutes,
    byCategory: categories.results.map((row) => ({ categoryKey: row.category_key, count: row.count })),
  };
}

export async function purgeTicketEvents(db: D1Database): Promise<{ events: number; staleClaims: number }> {
  const results = await db.batch([
    db.prepare(`DELETE FROM ticket_events WHERE created_at < datetime('now', '-180 days')`),
    db.prepare(
      `DELETE FROM ticket_open_claims WHERE
       (ticket_id IS NULL AND created_at < datetime('now', '-10 minutes')) OR
       (ticket_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM tickets WHERE tickets.id = ticket_open_claims.ticket_id AND tickets.status = 'open'
       ))`,
    ),
  ]);
  return { events: results[0]!.meta.changes, staleClaims: results[1]!.meta.changes };
}
