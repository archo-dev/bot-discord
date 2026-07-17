import { Hono, type Context } from "hono";
import { z } from "zod";
import { PermissionBits, hasPermission, type ModActionDto, type Paginated, PANEL_SANCTION_TYPES, type PanelSanctionType, type SanctionExemptionsDto, type WarningDto } from "@bot/shared";
import {
  claimPanelSanctionRequest,
  finishPanelSanctionRequest,
  getModAction,
  getWarning,
  getSanctionExemptions,
  insertModAction,
  insertWarning,
  listModActions,
  listWarnings,
  replaceSanctionExemptions,
  revokeModAction,
  revokeWarning,
  updateWarningReason,
} from "../db/queries.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";
import { DiscordAPIError, discordJson, discordRequest } from "../discord/rest.js";
import { isGuildModuleEnabled } from "../db/queries/modules.js";
import type { ModActionRow } from "../db/queries/mod-actions.js";
import { getDiscordGuildOwnerId } from "../moderation/owner.js";

export const moderationRouter = new Hono<AppContext>();
const SNOWFLAKE = /^\d{5,20}$/;
const STATUS = new Set(["active", "expired", "revoked", "failed"]);
const ACTIONS = new Set(["ban", "unban", "kick", "timeout", "auto_timeout", "warn", "unwarn", "clear"]);

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
}

function toDto(r: ModActionRow): ModActionDto {
  const expired = r.status === "active" && r.expires_at !== null && r.expires_at <= new Date().toISOString();
  return {
    id: r.id, action: r.action, targetId: r.target_id, moderatorId: r.moderator_id, reason: r.reason,
    metadata: parseMetadata(r.metadata), source: r.source, createdAt: r.created_at, expiresAt: r.expires_at,
    status: expired ? "expired" : r.status, revokedAt: r.revoked_at, revokedBy: r.revoked_by,
    revocationReason: r.revocation_reason,
  };
}

moderationRouter.get("/guilds/:guildId/mod-actions", async (c) => {
  const page = Number(c.req.query("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 100_000) return c.json({ error: "invalid_page" }, 400);
  const action = c.req.query("action") || undefined;
  const targetId = c.req.query("target") || undefined;
  const moderatorId = c.req.query("moderator") || undefined;
  const status = c.req.query("status") || undefined;
  const from = c.req.query("from") || undefined;
  const to = c.req.query("to") || undefined;
  if (action && !ACTIONS.has(action)) return c.json({ error: "invalid_action" }, 400);
  if ((targetId && !SNOWFLAKE.test(targetId)) || (moderatorId && !SNOWFLAKE.test(moderatorId))) return c.json({ error: "invalid_member_id" }, 400);
  if (status && !STATUS.has(status)) return c.json({ error: "invalid_status" }, 400);
  if ((from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) return c.json({ error: "invalid_period" }, 400);
  const result = await listModActions(c.env.DB, c.req.param("guildId"), { page, pageSize: 25, action, targetId, moderatorId, status, from, to });
  const body: Paginated<ModActionDto> = { items: result.rows.map((row) => toDto(row)), total: result.total, page, pageSize: 25 };
  return c.json(body);
});

moderationRouter.get("/guilds/:guildId/mod-actions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "invalid_action_id" }, 400);
  const row = await getModAction(c.env.DB, c.req.param("guildId"), id);
  return row ? c.json(toDto(row)) : c.json({ error: "not_found" }, 404);
});

moderationRouter.get("/guilds/:guildId/warnings", async (c) => {
  const userId = c.req.query("userId") || undefined;
  if (userId && !SNOWFLAKE.test(userId)) return c.json({ error: "invalid_member_id" }, 400);
  const rows = await listWarnings(c.env.DB, c.req.param("guildId"), userId);
  const body: WarningDto[] = rows.map((r) => ({ id: r.id, userId: r.user_id, moderatorId: r.moderator_id, reason: r.reason, createdAt: r.created_at, revokedAt: r.revoked_at, revokedBy: r.revoked_by }));
  return c.json(body);
});

const reasonSchema = z.object({ reason: z.string().trim().min(1).max(512).nullable() });

moderationRouter.patch("/guilds/:guildId/warnings/:warnId", rateLimit({ name: "warn-reason", limit: 20 }), async (c) => {
  const id = Number(c.req.param("warnId"));
  const parsed = reasonSchema.safeParse(await c.req.json().catch(() => null));
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "invalid_warning_id" }, 400);
  if (!parsed.success) return invalidBody(c, parsed.error);
  if (!(await updateWarningReason(c.env.DB, c.req.param("guildId"), id, parsed.data.reason))) return c.json({ error: "not_found" }, 404);
  await insertModAction(c.env.DB, { guildId: c.req.param("guildId"), action: "warn", targetId: null, moderatorId: c.get("session").userId, reason: `Raison du warn #${id} modifiée`, source: "panel" });
  return c.json({ ok: true });
});

moderationRouter.delete("/guilds/:guildId/warnings/:warnId", rateLimit({ name: "warn-revoke", limit: 30 }), async (c) => {
  const guildId = c.req.param("guildId");
  const warnId = Number(c.req.param("warnId"));
  if (!Number.isSafeInteger(warnId) || warnId < 1) return c.json({ error: "invalid_warning_id" }, 400);
  const warning = await getWarning(c.env.DB, guildId, warnId);
  if (!warning || warning.revoked_at) return c.json({ error: "not_found_or_already_revoked" }, 404);
  const revocationError = await validateRevocation(c, guildId, warning.user_id, "warn");
  if (revocationError) return c.json({ error: revocationError }, 403);
  const revoked = await revokeWarning(c.env.DB, guildId, warnId, c.get("session").userId);
  if (!revoked) return c.json({ error: "not_found_or_already_revoked" }, 404);
  await insertModAction(c.env.DB, { guildId, action: "unwarn", targetId: null, moderatorId: c.get("session").userId, reason: `Warn #${warnId} révoqué depuis le panel`, source: "panel" });
  return c.json({ ok: true });
});

moderationRouter.get("/guilds/:guildId/sanction-exemptions", async (c) => c.json(await getSanctionExemptions(c.env.DB, c.req.param("guildId"))));

const exemptionsSchema = z.object({
  warn: z.array(z.string().regex(SNOWFLAKE)).max(50), timeout: z.array(z.string().regex(SNOWFLAKE)).max(50),
  kick: z.array(z.string().regex(SNOWFLAKE)).max(50), ban: z.array(z.string().regex(SNOWFLAKE)).max(50),
}).superRefine((value, ctx) => {
  for (const [type, ids] of Object.entries(value)) if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: [type], message: "Un rôle ne peut être présent qu'une fois." });
});

moderationRouter.put("/guilds/:guildId/sanction-exemptions", rateLimit({ name: "sanction-exemptions", limit: 20 }), async (c) => {
  const parsed = exemptionsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  await replaceSanctionExemptions(c.env.DB, c.req.param("guildId"), parsed.data, c.get("session").userId);
  return c.json(parsed.data);
});

interface Role { id: string; position: number; permissions: string; }
interface Member { roles: string[]; user?: { bot?: boolean }; }

function memberPermissions(member: Member, roles: Role[]): string {
  const roleIds = new Set(member.roles);
  let permissions = 0n;
  for (const role of roles) if (role.position === 0 || roleIds.has(role.id)) permissions |= BigInt(role.permissions);
  return permissions.toString();
}
function highestRole(member: Member, roles: Role[]): number { const ids = new Set(member.roles); return Math.max(0, ...roles.filter((role) => ids.has(role.id)).map((role) => role.position)); }
function requiredPermission(type: PanelSanctionType): bigint { return type === "ban" ? PermissionBits.BAN_MEMBERS : type === "kick" ? PermissionBits.KICK_MEMBERS : PermissionBits.MODERATE_MEMBERS; }

async function validateTarget(c: Context<AppContext>, guildId: string, targetId: string, type: PanelSanctionType): Promise<{ error?: string; target?: Member }> {
  try {
    const bot = await discordJson<{ id: string }>(c.env, "GET", "/users/@me");
    const [ownerId, roles, actor, target, botMember, exemptions] = await Promise.all([
      getDiscordGuildOwnerId(c.env, guildId), discordJson<Role[]>(c.env, "GET", `/guilds/${guildId}/roles`),
      discordJson<Member>(c.env, "GET", `/guilds/${guildId}/members/${c.get("session").userId}`),
      discordJson<Member>(c.env, "GET", `/guilds/${guildId}/members/${targetId}`),
      discordJson<Member>(c.env, "GET", `/guilds/${guildId}/members/${bot.id}`), getSanctionExemptions(c.env.DB, guildId),
    ]);
    if (targetId === c.get("session").userId) return { error: "self_sanction_forbidden" };
    if (targetId === ownerId) return { error: "target_is_guild_owner" };
    if (target.user?.bot) return { error: "target_is_bot" };
    // The guild owner has an application-level panel override. Bot capability
    // and hierarchy remain mandatory checks below.
    if (c.get("session").userId !== ownerId && !hasPermission(memberPermissions(actor, roles), requiredPermission(type))) return { error: "actor_missing_discord_permission" };
    if (!hasPermission(memberPermissions(botMember, roles), requiredPermission(type))) return { error: "bot_missing_discord_permission" };
    const actorPosition = highestRole(actor, roles);
    const targetPosition = highestRole(target, roles);
    if (c.get("session").userId !== ownerId && actorPosition <= targetPosition) return { error: "actor_hierarchy_insufficient" };
    if (highestRole(botMember, roles) <= targetPosition) return { error: "bot_hierarchy_insufficient" };
    if (target.roles.some((id) => exemptions[type].includes(id))) return { error: "target_has_exempt_role" };
    return { target };
  } catch (error) {
    if (error instanceof DiscordAPIError && error.status === 404) return { error: "target_not_in_guild" };
    throw error;
  }
}

/**
 * Reversal authorization is intentionally separate from application. Target
 * exemptions and the historic moderator must never prevent a current owner
 * from revoking a reversible sanction.
 */
async function validateRevocation(c: Context<AppContext>, guildId: string, targetId: string | null, type: PanelSanctionType): Promise<string | null> {
  const bot = await discordJson<{ id: string }>(c.env, "GET", "/users/@me");
  const [ownerId, roles, actor, botMember, target] = await Promise.all([
    getDiscordGuildOwnerId(c.env, guildId),
    discordJson<Role[]>(c.env, "GET", `/guilds/${guildId}/roles`),
    discordJson<Member>(c.env, "GET", `/guilds/${guildId}/members/${c.get("session").userId}`),
    discordJson<Member>(c.env, "GET", `/guilds/${guildId}/members/${bot.id}`),
    targetId ? discordJson<Member>(c.env, "GET", `/guilds/${guildId}/members/${targetId}`).catch(() => null) : Promise.resolve(null),
  ]);
  const permission = requiredPermission(type);
  const isOwner = c.get("session").userId === ownerId;
  if (!isOwner && !hasPermission(memberPermissions(actor, roles), permission)) return "actor_missing_discord_permission";
  if (!hasPermission(memberPermissions(botMember, roles), permission)) return "bot_missing_discord_permission";
  if (!isOwner && targetId === ownerId) return "target_is_guild_owner";
  if (!isOwner && target && highestRole(actor, roles) <= highestRole(target, roles)) return "actor_hierarchy_insufficient";
  return null;
}

const createSchema = z.object({
  type: z.enum(PANEL_SANCTION_TYPES), targetId: z.string().regex(SNOWFLAKE), reason: z.string().trim().min(1).max(512),
  durationMinutes: z.number().int().min(1).max(40_320).optional(), idempotencyKey: z.string().uuid(),
}).superRefine((value, ctx) => { if (value.type === "timeout" && value.durationMinutes === undefined) ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "Une durée est requise pour un timeout." }); if (value.type !== "timeout" && value.durationMinutes !== undefined) ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "La durée est réservée au timeout." }); });

moderationRouter.post("/guilds/:guildId/sanctions", rateLimit({ name: "sanction-create", limit: 20 }), async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const guildId = c.req.param("guildId");
  if (!(await isGuildModuleEnabled(c.env.DB, guildId, "moderation"))) return c.json({ error: "moderation_module_disabled" }, 409);
  const claim = await claimPanelSanctionRequest(c.env.DB, guildId, parsed.data.idempotencyKey, c.get("session").userId);
  if (claim === "completed") return c.json({ error: "idempotency_replayed" }, 409);
  if (claim !== "claimed") return c.json({ error: "request_in_progress" }, 409);
  const valid = await validateTarget(c, guildId, parsed.data.targetId, parsed.data.type);
  if (valid.error) { await finishPanelSanctionRequest(c.env.DB, guildId, parsed.data.idempotencyKey, "failed", null); return c.json({ error: valid.error }, 403); }
  const { type, targetId, reason, durationMinutes, idempotencyKey } = parsed.data;
  const expiresAt = type === "timeout" ? new Date(Date.now() + durationMinutes! * 60_000).toISOString() : null;
  try {
    let metadata: Record<string, unknown> | undefined;
    if (type === "ban") await discordJson(c.env, "PUT", `/guilds/${guildId}/bans/${targetId}`, {}, { auditLogReason: reason });
    if (type === "kick") await discordJson(c.env, "DELETE", `/guilds/${guildId}/members/${targetId}`, undefined, { auditLogReason: reason });
    if (type === "timeout") { await discordJson(c.env, "PATCH", `/guilds/${guildId}/members/${targetId}`, { communication_disabled_until: expiresAt }, { auditLogReason: reason }); metadata = { durationMinutes }; }
    if (type === "warn") { const warningId = await insertWarning(c.env.DB, guildId, targetId, c.get("session").userId, reason); metadata = { warningId }; }
    const id = await insertModAction(c.env.DB, { guildId, action: type, targetId, moderatorId: c.get("session").userId, reason, metadata, source: "panel", expiresAt, idempotencyKey });
    await finishPanelSanctionRequest(c.env.DB, guildId, idempotencyKey, "completed", id);
    return c.json({ id, status: "active", expiresAt }, 201);
  } catch (error) {
    await finishPanelSanctionRequest(c.env.DB, guildId, idempotencyKey, "failed", null);
    if (error instanceof DiscordAPIError) return c.json({ error: error.status === 403 ? "discord_forbidden" : error.status === 429 ? "discord_rate_limited" : "discord_error" }, 502);
    throw error;
  }
});

const revokeSchema = z.object({ reason: z.string().trim().max(512).optional().default("") });
moderationRouter.post("/guilds/:guildId/sanctions/:id/revoke", rateLimit({ name: "sanction-revoke", limit: 20 }), async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = revokeSchema.safeParse(await c.req.json().catch(() => null));
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "invalid_action_id" }, 400);
  if (!parsed.success) return invalidBody(c, parsed.error);
  const guildId = c.req.param("guildId");
  const action = await getModAction(c.env.DB, guildId, id);
  if (!action) return c.json({ error: "not_found" }, 404);
  if (action.status !== "active") return c.json({ error: "already_resolved" }, 409);
  if (!["ban", "timeout", "auto_timeout", "warn"].includes(action.action)) return c.json({ error: "sanction_not_reversible" }, 409);
  try {
    const type: PanelSanctionType = action.action === "ban" ? "ban" : action.action === "warn" ? "warn" : "timeout";
    // A banned member is expected to be absent from the guild. Unban therefore
    // rechecks the actor and bot permissions but deliberately does not require
    // resolving the former member; Discord's 404 remains an idempotent success.
    const revocationError = await validateRevocation(c, guildId, action.action === "ban" ? null : action.target_id, type);
    if (revocationError) return c.json({ error: revocationError }, 403);
    if (action.action === "ban" && action.target_id) { const response = await discordRequest(c.env, "DELETE", `/guilds/${guildId}/bans/${action.target_id}`, undefined, { auditLogReason: parsed.data.reason || undefined }); if (!response.ok && response.status !== 404) throw new DiscordAPIError(response.status, await response.text(), "unban"); }
    if ((action.action === "timeout" || action.action === "auto_timeout") && action.target_id) await discordJson(c.env, "PATCH", `/guilds/${guildId}/members/${action.target_id}`, { communication_disabled_until: null }, { auditLogReason: parsed.data.reason || undefined });
    if (action.action === "warn") { const warningId = parseMetadata(action.metadata)?.warningId; if (typeof warningId === "number") await revokeWarning(c.env.DB, guildId, warningId, c.get("session").userId); }
    if (!(await revokeModAction(c.env.DB, guildId, id, c.get("session").userId, parsed.data.reason || null))) return c.json({ error: "already_resolved" }, 409);
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof DiscordAPIError) return c.json({ error: error.status === 403 ? "discord_forbidden" : "discord_error" }, 502);
    throw error;
  }
});
