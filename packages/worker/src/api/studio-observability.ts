import type { Hono } from "hono";
import { z } from "zod";
import {
  parseEnforcementMode,
  PLATFORM_FLAGS,
  type CapabilityId,
  type CapabilityReason,
  type CapabilityShadowResponse,
  type CapabilityShadowRow,
  type CapabilitySurface,
  type PlanId,
  type PlatformFlagKey,
  type RolloutFlagState,
  type RolloutResponse,
  type StudioErrorBucket,
  type StudioErrorsResponse,
  type StudioMetricsResponse,
  type StudioMetricsSummary,
} from "@bot/shared";
import { requireDeveloper, studioActionRateLimit, type StudioContext } from "../auth/studio-guard.js";
import { callerIp, writeStudioAudit } from "../security/studio-audit.js";
import {
  aggregateCapabilityShadow,
  aggregateMetricsForStudio,
  getRollout,
  listRollout,
  setRollout,
  topErrorsForStudio,
  type StudioMetricRow,
} from "../db/queries.js";

/**
 * Studio observability & cohort rollout (M15). Read dashboards under
 * deployments.read; editing a rollout cohort needs features.manage + Origin +
 * audit. Metrics are aggregated over pseudonymized guild keys — no PII.
 * Deployment triggering is intentionally absent (consultation only, D26).
 */

const ROLLOUT_FLAGS = Object.keys(PLATFORM_FLAGS) as PlatformFlagKey[];
const hoursSchema = z.coerce.number().int().min(1).max(168).default(24);

function toSummary(row: StudioMetricRow): StudioMetricsSummary {
  const events = row.events ?? 0;
  return {
    module: row.module,
    events,
    errors: row.errors ?? 0,
    errorRate: events > 0 ? (row.errors ?? 0) / events : 0,
    latencyLe100: row.latencyLe100 ?? 0,
    latencyLe250: row.latencyLe250 ?? 0,
    latencyLe500: row.latencyLe500 ?? 0,
    latencyLe1000: row.latencyLe1000 ?? 0,
    latencyLe2500: row.latencyLe2500 ?? 0,
    latencyLe5000: row.latencyLe5000 ?? 0,
    latencyGt5000: row.latencyGt5000 ?? 0,
    lastObservedAt: row.lastObservedAt,
  };
}

const rolloutPutSchema = z.object({
  global: z.boolean().default(false),
  guilds: z.array(z.string().regex(/^\d{5,20}$/)).max(500).default([]),
});

export function registerObservabilityRoutes(router: Hono<StudioContext>): void {
  router.get("/studio-api/metrics", requireDeveloper("deployments.read"), async (c) => {
    const parsed = hoursSchema.safeParse(c.req.query("hours") ?? 24);
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const hours = parsed.data;
    const rows = await aggregateMetricsForStudio(c.env.DB, hours);
    const modules = rows.map(toSummary);
    const body: StudioMetricsResponse = {
      windowHours: hours,
      totalEvents: modules.reduce((n, m) => n + m.events, 0),
      totalErrors: modules.reduce((n, m) => n + m.errors, 0),
      modules,
    };
    return c.json(body);
  });

  router.get("/studio-api/errors", requireDeveloper("deployments.read"), async (c) => {
    const parsed = hoursSchema.safeParse(c.req.query("hours") ?? 24);
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const hours = parsed.data;
    const rows = await topErrorsForStudio(c.env.DB, hours, 20);
    const items: StudioErrorBucket[] = rows.map((r) => ({ module: r.module, operation: r.operation, errors: r.errors ?? 0, events: r.events ?? 0 }));
    const body: StudioErrorsResponse = { windowHours: hours, items };
    return c.json(body);
  });

  router.get("/studio-api/rollout", requireDeveloper("deployments.read"), async (c) => {
    const states = await listRollout(c.env.KV, ROLLOUT_FLAGS);
    const flags: RolloutFlagState[] = ROLLOUT_FLAGS.map((flag) => ({ flag, global: states[flag]!.global, guilds: states[flag]!.guilds }));
    const body: RolloutResponse = { flags };
    return c.json(body);
  });

  router.put("/studio-api/rollout/:flag", requireDeveloper("features.manage"), studioActionRateLimit("rollout", 60, 3600), async (c) => {
    const flag = c.req.param("flag");
    if (!ROLLOUT_FLAGS.includes(flag as PlatformFlagKey)) return c.json({ error: "unknown_flag" }, 400);
    const parsed = rolloutPutSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body", fields: parsed.error.flatten().fieldErrors }, 400);
    const state = await setRollout(c.env.KV, flag, parsed.data);
    const operator = c.get("operator");
    c.executionCtx.waitUntil(
      writeStudioAudit(c.env, {
        actor: `operator:${operator.userId}`,
        action: "features.manage",
        targetType: "rollout",
        targetId: flag,
        metadata: { global: state.global, cohortSize: state.guilds.length },
        ip: callerIp(c),
      }),
    );
    const body: RolloutFlagState = { flag, global: state.global, guilds: state.guilds };
    return c.json(body);
  });

  // Vue opérateur agrégée du mode SHADOW d'enforcement des plans (no PII).
  // Consultation seule : appels totaux, allowed/would_block, impact, répartitions.
  router.get("/studio-api/capability-shadow", requireDeveloper("deployments.read"), async (c) => {
    const parsed = hoursSchema.safeParse(c.req.query("hours") ?? 24);
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const days = Math.max(1, Math.ceil(parsed.data / 24));
    const raw = await aggregateCapabilityShadow(c.env.DB, days);

    const rows: CapabilityShadowRow[] = raw.map((r) => ({
      surface: r.surface as CapabilitySurface,
      capability: r.capability as CapabilityId,
      effectivePlan: r.effective_plan as PlanId,
      requiredPlan: r.required_plan as PlanId,
      reason: r.reason as CapabilityReason,
      decision: r.decision === "would_block" ? "would_block" : "allowed",
      count: r.count,
    }));

    const totalCalls = rows.reduce((n, r) => n + r.count, 0);
    const wouldBlock = rows.filter((r) => r.decision === "would_block").reduce((n, r) => n + r.count, 0);

    const capMap = new Map<CapabilityId, { total: number; wouldBlock: number; reasons: Map<CapabilityReason, number> }>();
    const planMap = new Map<PlanId, { total: number; wouldBlock: number }>();
    const reasonMap = new Map<CapabilityReason, number>();
    for (const r of rows) {
      const cap = capMap.get(r.capability) ?? { total: 0, wouldBlock: 0, reasons: new Map() };
      cap.total += r.count;
      if (r.decision === "would_block") cap.wouldBlock += r.count;
      cap.reasons.set(r.reason, (cap.reasons.get(r.reason) ?? 0) + r.count);
      capMap.set(r.capability, cap);

      const plan = planMap.get(r.effectivePlan) ?? { total: 0, wouldBlock: 0 };
      plan.total += r.count;
      if (r.decision === "would_block") plan.wouldBlock += r.count;
      planMap.set(r.effectivePlan, plan);

      reasonMap.set(r.reason, (reasonMap.get(r.reason) ?? 0) + r.count);
    }

    const body: CapabilityShadowResponse = {
      windowHours: parsed.data,
      enforcementMode: parseEnforcementMode(c.env.CAPABILITY_ENFORCEMENT_MODE),
      totalCalls,
      allowed: totalCalls - wouldBlock,
      wouldBlock,
      impactRate: totalCalls > 0 ? wouldBlock / totalCalls : 0,
      byCapability: [...capMap.entries()]
        .map(([capability, v]) => ({
          capability,
          total: v.total,
          wouldBlock: v.wouldBlock,
          topReason: [...v.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        }))
        .sort((a, b) => b.wouldBlock - a.wouldBlock || b.total - a.total),
      byPlan: [...planMap.entries()].map(([effectivePlan, v]) => ({ effectivePlan, total: v.total, wouldBlock: v.wouldBlock })),
      byReason: [...reasonMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      rows,
    };
    return c.json(body);
  });

  // Non-mutating verification helper (dev-auth): does a flag apply to a guild now?
  router.get("/studio-api/rollout/:flag/check", requireDeveloper("deployments.read"), async (c) => {
    const flag = c.req.param("flag");
    if (!ROLLOUT_FLAGS.includes(flag as PlatformFlagKey)) return c.json({ error: "unknown_flag" }, 400);
    const guildId = c.req.query("guildId") ?? null;
    const rollout = await getRollout(c.env.KV, flag);
    const enabled = rollout.global || (guildId != null && rollout.guilds.includes(guildId));
    return c.json({ flag, guildId, enabled });
  });
}
