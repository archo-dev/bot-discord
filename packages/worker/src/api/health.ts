import { Hono } from "hono";
import {
  TELEMETRY_MODULES,
  type GatewayHeartbeatRuntime,
  type GuildHealthResponse,
  type HealthState,
  type ModuleHealthDto,
  type SloStatusDto,
} from "@bot/shared";
import { listHealthMetrics, type HealthMetricRow } from "../db/queries.js";
import type { AppContext } from "../auth/guard.js";
import { pseudonymizeGuild } from "../telemetry/request.js";

export const healthRouter = new Hono<AppContext>();

const LATENCY_BOUNDS = [100, 250, 500, 1000, 2500, 5000, 60_000] as const;
const HEALTH_MODULES = TELEMETRY_MODULES.filter((module) => !["core", "auth", "gateway", "cron"].includes(module));

function approximateP95(row: HealthMetricRow): number | null {
  const counts = [
    row.latencyLe100,
    row.latencyLe250,
    row.latencyLe500,
    row.latencyLe1000,
    row.latencyLe2500,
    row.latencyLe5000,
    row.latencyGt5000,
  ];
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const threshold = Math.ceil(total * 0.95);
  let cumulative = 0;
  for (let i = 0; i < counts.length; i++) {
    cumulative += counts[i]!;
    if (cumulative >= threshold) return LATENCY_BOUNDS[i]!;
  }
  return LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1]!;
}

function metricState(events: number, successRate: number | null, p95: number | null): HealthState {
  if (events === 0) return "inactive";
  if (successRate !== null && successRate < 0.8) return "unavailable";
  if ((successRate !== null && successRate < 0.99) || (p95 !== null && p95 > 1000)) return "degraded";
  return "operational";
}

function moduleDto(row: HealthMetricRow): ModuleHealthDto {
  const successRate = row.eventCount > 0 ? Math.max(0, (row.eventCount - row.errorCount) / row.eventCount) : null;
  const p95 = approximateP95(row);
  return {
    module: row.module,
    state: metricState(row.eventCount, successRate, p95),
    estimatedEvents: row.eventCount,
    sampledEvents: row.sampleCount,
    errors: row.errorCount,
    successRate,
    approximateP95Ms: p95,
    lastObservedAt: row.lastObservedAt,
  };
}

function combined(rows: HealthMetricRow[]): HealthMetricRow | null {
  if (rows.length === 0) return null;
  const sum = (pick: (row: HealthMetricRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    module: "core",
    eventCount: sum((r) => r.eventCount),
    sampleCount: sum((r) => r.sampleCount),
    errorCount: sum((r) => r.errorCount),
    latencyLe100: sum((r) => r.latencyLe100),
    latencyLe250: sum((r) => r.latencyLe250),
    latencyLe500: sum((r) => r.latencyLe500),
    latencyLe1000: sum((r) => r.latencyLe1000),
    latencyLe2500: sum((r) => r.latencyLe2500),
    latencyLe5000: sum((r) => r.latencyLe5000),
    latencyGt5000: sum((r) => r.latencyGt5000),
    lastObservedAt: rows.map((r) => r.lastObservedAt).sort().at(-1) ?? "",
  };
}

function percent(value: number | null): string {
  return value === null ? "Pas encore de données" : `${(value * 100).toFixed(1)} %`;
}

healthRouter.get("/guilds/:guildId/health", async (c) => {
  // Detailed technical health is restricted to full panel admins. Read-only
  // moderators must not receive runtime or operational details.
  if (c.get("guildAccess") === "panel_moderator") return c.json({ error: "forbidden" }, 403);

  const guildKey = await pseudonymizeGuild(c.env.SESSION_SECRET, c.req.param("guildId"));
  const rows = await listHealthMetrics(c.env.DB, guildKey, 24);
  const visibleRows = rows.filter((row) => HEALTH_MODULES.includes(row.module));
  const modules = visibleRows.map(moduleDto);

  const rawGateway = await c.env.KV.get("gateway:status");
  let gatewayAt: number | null = null;
  let guildCount: number | null = null;
  let wsPingMs: number | null = null;
  let runtime: GatewayHeartbeatRuntime | null = null;
  if (rawGateway) {
    try {
      const parsed = JSON.parse(rawGateway) as {
        at?: number;
        guildCount?: number;
        wsPing?: number | null;
        runtime?: GatewayHeartbeatRuntime | null;
      };
      gatewayAt = typeof parsed.at === "number" ? parsed.at : null;
      guildCount = typeof parsed.guildCount === "number" ? parsed.guildCount : null;
      wsPingMs = typeof parsed.wsPing === "number" ? parsed.wsPing : null;
      runtime = parsed.runtime ?? null;
    } catch {
      // A malformed/old KV value is represented as unavailable, never leaked.
    }
  }
  const heartbeatAgeSeconds = gatewayAt === null ? null : Math.max(0, Math.round((Date.now() - gatewayAt) / 1000));
  const gatewayState: HealthState =
    heartbeatAgeSeconds === null
      ? "unavailable"
      : heartbeatAgeSeconds > 180 || (runtime?.errorsSinceLastHeartbeat ?? 0) > 0 || (wsPingMs ?? 0) > 250
        ? "degraded"
        : "operational";

  const apiRows = visibleRows.filter((row) => row.module !== "interactions");
  const api = combined(apiRows);
  const interaction = combined(visibleRows.filter((row) => row.module === "interactions"));
  const apiSuccess = api && api.eventCount > 0 ? (api.eventCount - api.errorCount) / api.eventCount : null;
  const interactionSuccess =
    interaction && interaction.eventCount > 0 ? (interaction.eventCount - interaction.errorCount) / interaction.eventCount : null;
  const apiP95 = api ? approximateP95(api) : null;
  const slos: SloStatusDto[] = [
    {
      id: "api_availability",
      label: "Disponibilité de l’API panel",
      state: apiSuccess === null ? "inactive" : apiSuccess >= 0.99 ? "operational" : apiSuccess >= 0.95 ? "degraded" : "unavailable",
      target: "≥ 99 % sur 24 h",
      value: percent(apiSuccess),
    },
    {
      id: "api_latency",
      label: "Latence API panel",
      state: apiP95 === null ? "inactive" : apiP95 <= 1000 ? "operational" : apiP95 <= 2500 ? "degraded" : "unavailable",
      target: "p95 approximatif ≤ 1 000 ms",
      value: apiP95 === null ? "Pas encore de données" : `≤ ${apiP95.toLocaleString("fr-FR")} ms`,
    },
    {
      id: "gateway_freshness",
      label: "Fraîcheur de la Gateway",
      state: gatewayState,
      target: "heartbeat ≤ 180 s",
      value: heartbeatAgeSeconds === null ? "Aucun heartbeat" : `${heartbeatAgeSeconds} s`,
    },
    {
      id: "interaction_success",
      label: "Succès des interactions Discord",
      state:
        interactionSuccess === null
          ? "inactive"
          : interactionSuccess >= 0.99
            ? "operational"
            : interactionSuccess >= 0.95
              ? "degraded"
              : "unavailable",
      target: "≥ 99 % sur 24 h",
      value: percent(interactionSuccess),
    },
  ];

  const body: GuildHealthResponse = {
    requestId: c.get("requestId"),
    generatedAt: new Date().toISOString(),
    windowHours: 24,
    gateway: {
      state: gatewayState,
      lastHeartbeatAt: gatewayAt === null ? null : new Date(gatewayAt).toISOString(),
      heartbeatAgeSeconds,
      guildCount,
      wsPingMs,
      runtime,
    },
    modules,
    slos,
    retentionDays: 30,
    sampled: true,
  };
  return c.json(body);
});
