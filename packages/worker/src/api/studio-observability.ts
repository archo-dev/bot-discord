import type { Hono } from "hono";
import { z } from "zod";
import {
  PLATFORM_FLAGS,
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
