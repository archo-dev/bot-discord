import type { AdminAuditEntryDto, AdminAuditOutcome, PanelCapability, PanelGuildAccess } from "@bot/shared";

export async function consumeInternalNonce(
  db: D1Database,
  direction: "gateway-to-worker",
  nonceHash: string,
  timestamp: number,
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO internal_request_nonces (direction, nonce_hash, expires_at)
     VALUES (?1, ?2, datetime(?3, 'unixepoch', '+5 minutes'))
     ON CONFLICT(direction, nonce_hash) DO NOTHING`,
  ).bind(direction, nonceHash, timestamp).run();
  return (result.meta.changes ?? 0) === 1;
}

export type DurableQuotaCapability = "discord_publish" | "guild_identity" | "music_control";

export async function consumeDurableQuota(db: D1Database, input: {
  day: string;
  guildKey: string;
  guildScopeKey: string;
  userScopeKey: string;
  capability: DurableQuotaCapability;
  guildLimit: number;
  userLimit: number;
}): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO security_quota_usage (day, guild_key, scope_type, scope_key, capability, count)
     SELECT ?1, ?2, 'guild', ?3, ?5, 1
      WHERE COALESCE((SELECT count FROM security_quota_usage
                       WHERE day = ?1 AND guild_key = ?2 AND scope_type = 'guild' AND scope_key = ?3 AND capability = ?5), 0) < ?6
        AND COALESCE((SELECT count FROM security_quota_usage
                       WHERE day = ?1 AND guild_key = ?2 AND scope_type = 'user' AND scope_key = ?4 AND capability = ?5), 0) < ?7
     UNION ALL
     SELECT ?1, ?2, 'user', ?4, ?5, 1
      WHERE COALESCE((SELECT count FROM security_quota_usage
                       WHERE day = ?1 AND guild_key = ?2 AND scope_type = 'guild' AND scope_key = ?3 AND capability = ?5), 0) < ?6
        AND COALESCE((SELECT count FROM security_quota_usage
                       WHERE day = ?1 AND guild_key = ?2 AND scope_type = 'user' AND scope_key = ?4 AND capability = ?5), 0) < ?7
     ON CONFLICT(day, guild_key, scope_type, scope_key, capability) DO UPDATE SET
       count = count + 1,
       updated_at = datetime('now')
     RETURNING scope_type`,
  ).bind(input.day, input.guildKey, input.guildScopeKey, input.userScopeKey, input.capability, input.guildLimit, input.userLimit).all<{ scope_type: string }>();
  return result.results.length === 2;
}

export interface AdminAuditInput {
  guildId: string;
  actorId: string;
  actorAccess: PanelGuildAccess;
  capability: PanelCapability;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  targetType: "command" | "warning" | "button_role" | null;
  targetId: string | null;
  outcome: "success" | "error";
  status: number;
  requestId: string;
}

export async function insertAdminAudit(db: D1Database, input: AdminAuditInput): Promise<void> {
  await db.prepare(
    `INSERT INTO admin_audit_log
       (guild_id, actor_id, actor_access, capability, method, target_type, target_id, outcome, status, request_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  ).bind(
    input.guildId, input.actorId, input.actorAccess, input.capability, input.method,
    input.targetType, input.targetId, input.outcome, input.status, input.requestId,
  ).run();
}

interface AdminAuditRow {
  id: number;
  actor_id: string;
  actor_access: PanelGuildAccess;
  capability: PanelCapability;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  target_type: "command" | "warning" | "button_role" | null;
  target_id: string | null;
  outcome: AdminAuditOutcome;
  status: number;
  request_id: string;
  created_at: string;
}

export async function listAdminAudit(db: D1Database, input: {
  guildId: string;
  limit: number;
  cursor: number | null;
  capability: PanelCapability | null;
  outcome: AdminAuditOutcome | null;
}): Promise<{ items: AdminAuditEntryDto[]; nextCursor: string | null }> {
  const result = await db.prepare(
    `SELECT id, actor_id, actor_access, capability, method, target_type, target_id,
            outcome, status, request_id, created_at
       FROM admin_audit_log
      WHERE guild_id = ?1
        AND (?2 IS NULL OR id < ?2)
        AND (?3 IS NULL OR capability = ?3)
        AND (?4 IS NULL OR outcome = ?4)
      ORDER BY id DESC
      LIMIT ?5`,
  ).bind(input.guildId, input.cursor, input.capability, input.outcome, input.limit + 1).all<AdminAuditRow>();
  const rows = result.results.slice(0, input.limit);
  return {
    items: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorAccess: row.actor_access,
      capability: row.capability,
      method: row.method,
      targetType: row.target_type,
      targetId: row.target_id,
      outcome: row.outcome,
      status: row.status,
      requestId: row.request_id,
      createdAt: row.created_at,
    })),
    nextCursor: result.results.length > input.limit ? String(rows.at(-1)!.id) : null,
  };
}

export async function purgeSecurityData(db: D1Database): Promise<{ nonces: number; quotas: number; audit: number }> {
  const [nonces, quotas, audit] = await db.batch([
    db.prepare(`DELETE FROM internal_request_nonces WHERE expires_at < datetime('now')`),
    db.prepare(`DELETE FROM security_quota_usage WHERE day < date('now', '-7 days')`),
    db.prepare(`DELETE FROM admin_audit_log WHERE created_at < datetime('now', '-90 days')`),
  ]);
  return {
    nonces: nonces!.meta.changes ?? 0,
    quotas: quotas!.meta.changes ?? 0,
    audit: audit!.meta.changes ?? 0,
  };
}
