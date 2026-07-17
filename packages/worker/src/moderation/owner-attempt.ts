import { subscribedAutomationEventStatement } from "../db/queries/automations.js";

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

  if (!(await claimWarnSlot(db, input.guildId, input.actorId))) {
    await setResult(db, input, "rate_limited");
    return "rate_limited";
  }

  try {
    const eventId = `warn:${crypto.randomUUID()}`;
    // D1 batch is transactional: a failed case write rolls the warning back,
    // so there can never be an active automatic warning without its audit case.
    await db.batch([
      db.prepare(`INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?1, ?2, 'system', ?3)`)
        .bind(input.guildId, input.actorId, REASON),
      db.prepare(`UPDATE owner_target_attempts SET warning_id = last_insert_rowid(), updated_at = datetime('now') WHERE guild_id = ?1 AND request_id = ?2`)
        .bind(input.guildId, input.requestId),
      subscribedAutomationEventStatement(db, {
        id: eventId,
        guildId: input.guildId,
        triggerType: "warn_created",
        context: {
          event: { type: "warn_created", id: eventId, depth: 0 },
          guild: { id: input.guildId },
          user: { id: input.actorId },
          reason: REASON,
        },
        requirePreviousChange: true,
      }),
      db.prepare(
        `INSERT INTO mod_actions (guild_id, action, target_id, moderator_id, reason, metadata, source)
         SELECT guild_id, 'warn', actor_id, 'system', ?3,
                json_object('automatic', 1, 'kind', 'owner_target_attempt', 'warningId', warning_id,
                            'actorId', actor_id, 'ownerId', owner_id, 'attemptedSanction', sanction_type,
                            'origin', origin, 'requestId', request_id),
                CASE origin WHEN 'panel' THEN 'panel' WHEN 'slash' THEN 'interaction' ELSE 'gateway' END
           FROM owner_target_attempts WHERE guild_id = ?1 AND request_id = ?2`,
      ).bind(input.guildId, input.requestId, REASON),
      db.prepare(`UPDATE owner_target_attempts SET result = 'warn_recorded', mod_action_id = last_insert_rowid(), updated_at = datetime('now') WHERE guild_id = ?1 AND request_id = ?2`)
        .bind(input.guildId, input.requestId),
    ]);
    return "warn_recorded";
  } catch (error) {
    // The attempted sanction remains forbidden even if D1 is unavailable.
    await releaseWarnSlot(db, input.guildId, input.actorId).catch(() => undefined);
    await setResult(db, input, "failed").catch(() => undefined);
    throw error;
  }
}

/** Atomic and D1-backed: concurrent Workers cannot exceed the configured cap. */
async function claimWarnSlot(db: D1Database, guildId: string, actorId: string): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO owner_target_attempt_limits (guild_id, actor_id, window_start, warn_count)
     VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:00Z', 'now'), 1)
     ON CONFLICT(guild_id, actor_id, window_start) DO UPDATE SET warn_count = warn_count + 1
       WHERE warn_count < ?3
     RETURNING warn_count`,
  ).bind(guildId, actorId, WARN_LIMIT_PER_MINUTE).all<{ warn_count: number }>();
  return result.results.length === 1;
}

async function releaseWarnSlot(db: D1Database, guildId: string, actorId: string): Promise<void> {
  await db.prepare(
    `UPDATE owner_target_attempt_limits SET warn_count = warn_count - 1
      WHERE guild_id = ?1 AND actor_id = ?2 AND window_start = strftime('%Y-%m-%dT%H:%M:00Z', 'now') AND warn_count > 0`,
  ).bind(guildId, actorId).run();
}

async function setResult(db: D1Database, input: OwnerTargetAttempt, result: "audit_only" | "rate_limited" | "failed"): Promise<void> {
  await db.prepare(
    `UPDATE owner_target_attempts SET result = ?3, updated_at = datetime('now') WHERE guild_id = ?1 AND request_id = ?2`,
  ).bind(input.guildId, input.requestId, result).run();
}

export const OWNER_TARGET_ATTEMPT_REASON = REASON;

/** Retain the audit for 90 days and short-lived limiter windows for 2 days. */
export async function purgeOwnerTargetAttemptData(db: D1Database): Promise<{ attempts: number; limits: number }> {
  const [attempts, limits] = await db.batch([
    db.prepare(`DELETE FROM owner_target_attempts WHERE created_at < datetime('now', '-90 days')`),
    db.prepare(`DELETE FROM owner_target_attempt_limits WHERE window_start < strftime('%Y-%m-%dT%H:%M:00Z', 'now', '-2 days')`),
  ]);
  return { attempts: attempts!.meta.changes ?? 0, limits: limits!.meta.changes ?? 0 };
}
