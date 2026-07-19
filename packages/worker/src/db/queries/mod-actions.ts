/** Moderation audit log (mod_actions), paginated for the ModLog panel page. */
import { subscribedAutomationEventStatement } from "./automations.js";

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
  expires_at: string | null;
  status: "active" | "expired" | "revoked" | "failed";
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  idempotency_key: string | null;
}

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
    expiresAt?: string | null;
    idempotencyKey?: string;
  },
): Promise<number> {
  const eventId = `mute:${crypto.randomUUID()}`;
  const results = await db.batch([
    db.prepare(
      `INSERT INTO mod_actions (guild_id, action, target_id, moderator_id, reason, metadata, source, expires_at, idempotency_key)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
    )
    .bind(
      entry.guildId,
      entry.action,
      entry.targetId,
      entry.moderatorId,
      entry.reason,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.source ?? "interaction",
      entry.expiresAt ?? null,
      entry.idempotencyKey ?? null,
    ),
    subscribedAutomationEventStatement(db, {
      id: eventId,
      guildId: entry.guildId,
      triggerType: "mute_applied",
      context: {
        event: { type: "mute_applied", id: eventId, depth: 0 },
        guild: { id: entry.guildId },
        ...(entry.targetId ? { user: { id: entry.targetId } } : {}),
        reason: entry.reason ?? "",
      },
      enabled: entry.moderatorId !== "automation"
        && entry.targetId !== null
        && (entry.action === "timeout" || entry.action === "auto_timeout"),
      requirePreviousChange: true,
    }),
  ]);
  const row = results[0]?.results[0] as { id: number } | undefined;
  return row!.id;
}

/** Escapes LIKE wildcards so a text search matches the term literally. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listModActions(
  db: D1Database,
  guildId: string,
  opts: { page: number; pageSize: number; action?: string; targetId?: string; moderatorId?: string; status?: string; source?: string; q?: string; from?: string; to?: string },
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
  if (opts.moderatorId) { binds.push(opts.moderatorId); where.push(`moderator_id = ?${binds.length}`); }
  if (opts.source) { binds.push(opts.source); where.push(`source = ?${binds.length}`); }
  if (opts.q) { binds.push(`%${escapeLike(opts.q)}%`); where.push(`reason LIKE ?${binds.length} ESCAPE '\\'`); }
  if (opts.status) {
    binds.push(opts.status);
    where.push(`(CASE WHEN status = 'active' AND expires_at IS NOT NULL AND julianday(expires_at) <= julianday('now') THEN 'expired' ELSE status END) = ?${binds.length}`);
  }
  if (opts.from) { binds.push(opts.from); where.push(`created_at >= ?${binds.length}`); }
  if (opts.to) { binds.push(opts.to); where.push(`created_at <= ?${binds.length}`); }
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

export async function getModAction(db: D1Database, guildId: string, id: number): Promise<ModActionRow | null> {
  return db.prepare(`SELECT * FROM mod_actions WHERE guild_id = ?1 AND id = ?2`).bind(guildId, id).first<ModActionRow>();
}

export async function revokeModAction(db: D1Database, guildId: string, id: number, actorId: string, reason: string | null): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE mod_actions
        SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ?3, revocation_reason = ?4
      WHERE guild_id = ?1 AND id = ?2 AND status = 'active'`,
  ).bind(guildId, id, actorId, reason).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function claimPanelSanctionRequest(db: D1Database, guildId: string, key: string, actorId: string): Promise<"claimed" | "pending" | "completed" | "failed"> {
  const inserted = await db.prepare(
    `INSERT INTO panel_sanction_requests (guild_id, idempotency_key, actor_id, status)
     VALUES (?1, ?2, ?3, 'pending') ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
  ).bind(guildId, key, actorId).run();
  if ((inserted.meta.changes ?? 0) === 1) return "claimed";
  const row = await db.prepare(`SELECT status FROM panel_sanction_requests WHERE guild_id = ?1 AND idempotency_key = ?2`).bind(guildId, key).first<{ status: "pending" | "completed" | "failed" }>();
  return row?.status ?? "failed";
}

export async function finishPanelSanctionRequest(db: D1Database, guildId: string, key: string, status: "completed" | "failed", actionId: number | null): Promise<void> {
  await db.prepare(
    `UPDATE panel_sanction_requests SET status = ?3, action_id = ?4, updated_at = datetime('now')
      WHERE guild_id = ?1 AND idempotency_key = ?2`,
  ).bind(guildId, key, status, actionId).run();
}
