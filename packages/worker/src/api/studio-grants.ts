import type { Hono } from "hono";
import { z } from "zod";
import {
  GRANTABLE_PLANS,
  resolveGrantWindow,
  type GrantablePlan,
  type GrantDurationKind,
  type GrantSummary,
  type GrantsListResponse,
} from "@bot/shared";
import {
  requireDeveloper,
  requireStepUp,
  studioActionRateLimit,
  type StudioContext,
} from "../auth/studio-guard.js";
import { callerIp, writeStudioAudit } from "../security/studio-audit.js";
import {
  getEntitlementSourceStatus,
  insertGrantWithEntitlement,
  insertSubscriptionEvent,
  listGrants,
  revokeGrantedEntitlement,
  type GrantJoinRow,
} from "../db/queries.js";

/**
 * Manual grants & lifetime (M13). Registered on the shared studioApiRouter so it
 * inherits host-gating + studio session + Origin checks. Backend is the sole
 * authority: revocation never touches a `paid` (guard in queries), lifetime needs
 * the distinct grant_lifetime permission + explicit LIFETIME typing, and an
 * operator can never grant to themselves (auto-attribution forbidden, D11).
 */

const snowflake = z.string().regex(/^\d{5,20}$/);
const plan = z.enum(GRANTABLE_PLANS as unknown as [GrantablePlan, ...GrantablePlan[]]);
const reason = z.string().trim().min(3).max(500);
const internalNote = z.string().trim().max(2000).optional();

const grantSchema = z.object({
  userId: snowflake,
  planId: plan,
  durationKind: z.enum(["7d", "30d", "3m", "6m", "1y", "custom"]),
  customEndAt: z.string().datetime().optional(),
  reason,
  internalNote,
});

const lifetimeSchema = z.object({
  userId: snowflake,
  planId: plan,
  reason,
  internalNote,
  confirm: z.string(),
});

const revokeSchema = z.object({ reason: z.string().trim().max(500).optional() });
const idSchema = z.coerce.number().int().positive();

function toSummary(row: GrantJoinRow): GrantSummary {
  return {
    grantId: row.id,
    entitlementId: row.entitlement_id,
    userId: row.user_id,
    planId: row.plan_id as GrantablePlan,
    durationKind: row.duration_kind as GrantDurationKind,
    isLifetime: row.is_lifetime === 1,
    status: row.status,
    reason: row.reason,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    endAt: row.end_at,
  };
}

export function registerGrantRoutes(router: Hono<StudioContext>): void {
  router.get("/studio-api/subscriptions/granted", requireDeveloper("subscriptions.read"), async (c) => {
    const page = Number(c.req.query("page") ?? 1) || 1;
    const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") ?? 20) || 20));
    const { rows, total } = await listGrants(c.env.DB, page, pageSize);
    const body: GrantsListResponse = { items: rows.map(toSummary), total, page, pageSize };
    return c.json(body);
  });

  router.post("/studio-api/subscriptions/grant", requireDeveloper("subscriptions.grant"), studioActionRateLimit("grant", 20, 3600), async (c) => {
    const parsed = grantSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body", fields: parsed.error.flatten().fieldErrors }, 400);
    const operator = c.get("operator");
    // Auto-attribution forbidden (D11): an operator can never grant to themselves.
    if (parsed.data.userId === operator.userId) return c.json({ error: "self_grant_forbidden" }, 403);

    const startAt = new Date().toISOString();
    let window;
    try {
      window = resolveGrantWindow(parsed.data.durationKind, startAt, parsed.data.customEndAt ?? null);
    } catch {
      return c.json({ error: "invalid_duration" }, 400);
    }
    const { entitlementId, grantId } = await insertGrantWithEntitlement(c.env.DB, {
      userId: parsed.data.userId,
      planId: parsed.data.planId,
      startAt,
      endAt: window.endAt,
      isLifetime: window.isLifetime,
      durationKind: parsed.data.durationKind,
      grantedBy: operator.userId,
      reason: parsed.data.reason,
      internalNote: parsed.data.internalNote ?? null,
    });
    await insertSubscriptionEvent(c.env.DB, {
      entitlementId,
      type: "grant",
      toStatus: "active",
      actor: `operator:${operator.userId}`,
      payload: { grantId, planId: parsed.data.planId, durationKind: parsed.data.durationKind },
    });
    c.executionCtx.waitUntil(
      writeStudioAudit(c.env, {
        actor: `operator:${operator.userId}`,
        action: "subscriptions.grant",
        targetType: "entitlement",
        targetId: String(entitlementId),
        metadata: { grantId, userId: parsed.data.userId, planId: parsed.data.planId, durationKind: parsed.data.durationKind, reason: parsed.data.reason },
        ip: callerIp(c),
      }),
    );
    return c.json({ ok: true, entitlementId, grantId }, 201);
  });

  router.post(
    "/studio-api/subscriptions/grant-lifetime",
    requireDeveloper("subscriptions.grant_lifetime"),
    requireStepUp(),
    studioActionRateLimit("grant_lifetime", 5, 3600),
    async (c) => {
    const parsed = lifetimeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body", fields: parsed.error.flatten().fieldErrors }, 400);
    // Anti-error explicit typing — lifetime is a permanent commitment (doc 06 §lifetime).
    if (parsed.data.confirm !== "LIFETIME") return c.json({ error: "confirmation_required" }, 400);
    const operator = c.get("operator");
    if (parsed.data.userId === operator.userId) return c.json({ error: "self_grant_forbidden" }, 403);

    const startAt = new Date().toISOString();
    const window = resolveGrantWindow("lifetime", startAt);
    const { entitlementId, grantId } = await insertGrantWithEntitlement(c.env.DB, {
      userId: parsed.data.userId,
      planId: parsed.data.planId,
      startAt,
      endAt: window.endAt,
      isLifetime: window.isLifetime,
      durationKind: "lifetime",
      grantedBy: operator.userId,
      reason: parsed.data.reason,
      internalNote: parsed.data.internalNote ?? null,
    });
    await insertSubscriptionEvent(c.env.DB, {
      entitlementId,
      type: "grant_lifetime",
      toStatus: "active",
      actor: `operator:${operator.userId}`,
      payload: { grantId, planId: parsed.data.planId },
    });
    c.executionCtx.waitUntil(
      writeStudioAudit(c.env, {
        actor: `operator:${operator.userId}`,
        action: "subscriptions.grant_lifetime",
        targetType: "entitlement",
        targetId: String(entitlementId),
        metadata: { grantId, userId: parsed.data.userId, planId: parsed.data.planId, reason: parsed.data.reason },
        ip: callerIp(c),
      }),
    );
    return c.json({ ok: true, entitlementId, grantId, isLifetime: true }, 201);
  });

  router.post("/studio-api/subscriptions/:entitlementId/revoke", requireDeveloper("subscriptions.revoke_granted"), studioActionRateLimit("revoke_granted", 30, 3600), async (c) => {
    const id = idSchema.safeParse(c.req.param("entitlementId"));
    if (!id.success) return c.json({ error: "invalid_id" }, 400);
    const parsed = revokeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const operator = c.get("operator");

    const before = await getEntitlementSourceStatus(c.env.DB, id.data);
    const res = await revokeGrantedEntitlement(c.env.DB, id.data, operator.userId, parsed.data.reason ?? null);
    if (!res.ok) {
      const status = res.code === "not_found" ? 404 : res.code === "cannot_revoke_paid" ? 409 : 409;
      return c.json({ error: res.code }, status);
    }
    await insertSubscriptionEvent(c.env.DB, {
      entitlementId: id.data,
      type: "revoke_granted",
      fromStatus: before?.status ?? null,
      toStatus: "revoked",
      actor: `operator:${operator.userId}`,
      payload: { reason: parsed.data.reason ?? null },
    });
    c.executionCtx.waitUntil(
      writeStudioAudit(c.env, {
        actor: `operator:${operator.userId}`,
        action: "subscriptions.revoke_granted",
        targetType: "entitlement",
        targetId: String(id.data),
        metadata: { reason: parsed.data.reason ?? null },
        ip: callerIp(c),
      }),
    );
    return c.json({ ok: true });
  });
}
