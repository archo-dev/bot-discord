import { insertModAction, insertWarning } from "../db/queries.js";

const REASON = "Tentative non autorisée de sanction contre le propriétaire du serveur.";
const HUMAN_ID = /^\d{5,20}$/;
const WARN_LIMIT_PER_MINUTE = 5;

export type OwnerAttemptOrigin = "slash" | "panel" | "automation";
export type OwnerAttemptType = "warn" | "timeout" | "kick" | "ban";

export interface OwnerTargetAttempt {
  guildId: string;
  actorId: string;
  ownerId: string;
  sanctionType: OwnerAttemptType;
  origin: OwnerAttemptOrigin;
  requestId: string;
}

/**
 * Records a blocked owner-target attempt without calling any sanction route.
 * The primary key is the idempotency boundary; a retry can never issue a
 * second warning. System actors and the owner themselves retain an audit row
 * but never receive a user warning.
 */
export async function recordOwnerTargetAttempt(db: D1Database, input: OwnerTargetAttempt): Promise<"warn_recorded" | "audit_only" | "rate_limited" | "duplicate"> {
  const claim = await db.prepare(
    `INSERT INTO owner_target_attempts
       (guild_id, request_id, actor_id, owner_id, sanction_type, origin, result)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')
     ON CONFLICT(guild_id, request_id) DO NOTHING`,
  ).bind(input.guildId, input.requestId, input.actorId, input.ownerId, input.sanctionType, input.origin).run();
  if ((claim.meta.changes ?? 0) === 0) return "duplicate";

  const humanActor = HUMAN_ID.test(input.actorId) && input.actorId !== input.ownerId;
  if (!humanActor) {
    await setResult(db, input, "audit_only");
    return "audit_only";
  }

  const recent = await db.prepare(
    `SELECT COUNT(*) AS count FROM owner_target_attempts
      WHERE guild_id = ?1 AND actor_id = ?2 AND result = 'warn_recorded'
        AND created_at >= datetime('now', '-1 minute')`,
  ).bind(input.guildId, input.actorId).first<{ count: number }>();
  if ((recent?.count ?? 0) >= WARN_LIMIT_PER_MINUTE) {
    await setResult(db, input, "rate_limited");
    return "rate_limited";
  }

  try {
    const warningId = await insertWarning(db, input.guildId, input.actorId, "system", REASON);
    const modActionId = await insertModAction(db, {
      guildId: input.guildId,
      action: "warn",
      targetId: input.actorId,
      moderatorId: "system",
      reason: REASON,
      source: input.origin === "panel" ? "panel" : input.origin === "slash" ? "interaction" : "gateway",
      metadata: { automatic: true, kind: "owner_target_attempt", warningId, actorId: input.actorId, ownerId: input.ownerId, attemptedSanction: input.sanctionType, origin: input.origin, requestId: input.requestId },
    });
    await db.prepare(
      `UPDATE owner_target_attempts SET result = 'warn_recorded', warning_id = ?3, mod_action_id = ?4, updated_at = datetime('now')
        WHERE guild_id = ?1 AND request_id = ?2`,
    ).bind(input.guildId, input.requestId, warningId, modActionId).run();
    return "warn_recorded";
  } catch (error) {
    // The attempted sanction remains forbidden even if D1 is unavailable.
    await setResult(db, input, "failed").catch(() => undefined);
    throw error;
  }
}

async function setResult(db: D1Database, input: OwnerTargetAttempt, result: "audit_only" | "rate_limited" | "failed"): Promise<void> {
  await db.prepare(
    `UPDATE owner_target_attempts SET result = ?3, updated_at = datetime('now') WHERE guild_id = ?1 AND request_id = ?2`,
  ).bind(input.guildId, input.requestId, result).run();
}

export const OWNER_TARGET_ATTEMPT_REASON = REASON;
