import type { PanelCapability, PanelGuildAccess } from "@bot/shared";

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
     VALUES (?1, ?2, 'guild', ?3, ?5, 1), (?1, ?2, 'user', ?4, ?5, 1)
     ON CONFLICT(day, guild_key, scope_type, scope_key, capability) DO UPDATE SET
       count = count + 1,
       updated_at = datetime('now')
     WHERE count < CASE excluded.scope_type WHEN 'guild' THEN ?6 ELSE ?7 END
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
