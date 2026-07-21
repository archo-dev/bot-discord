import type { TelemetryModule, TelemetryOperation, TelemetryOutcome } from "@bot/shared";

export interface OperationMetricInput {
  guildKey: string;
  module: TelemetryModule;
  operation: TelemetryOperation;
  outcome: TelemetryOutcome;
  durationMs: number;
  /** Sampling weight: 4 means this sample estimates four success events. */
  weight: number;
  at?: Date;
}

function hourBucket(at: Date): string {
  return `${at.toISOString().slice(0, 13)}:00:00Z`;
}

function histogram(durationMs: number, weight: number): number[] {
  const values = [0, 0, 0, 0, 0, 0, 0];
  const index =
    durationMs <= 100 ? 0 : durationMs <= 250 ? 1 : durationMs <= 500 ? 2 : durationMs <= 1000 ? 3 : durationMs <= 2500 ? 4 : durationMs <= 5000 ? 5 : 6;
  values[index] = weight;
  return values;
}

export async function recordOperationMetric(db: D1Database, input: OperationMetricInput): Promise<void> {
  const durationMs = Math.max(0, Math.min(60_000, Math.round(input.durationMs)));
  const weight = Math.max(1, Math.min(100, Math.round(input.weight)));
  const h = histogram(durationMs, weight);
  await db
    .prepare(
      `INSERT INTO operation_metrics (
         guild_key, bucket, module, operation, outcome,
         event_count, sample_count, error_count, latency_sum_ms, latency_max_ms,
         latency_le_100, latency_le_250, latency_le_500, latency_le_1000,
         latency_le_2500, latency_le_5000, latency_gt_5000
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
       ON CONFLICT(guild_key, bucket, module, operation, outcome) DO UPDATE SET
         event_count = event_count + excluded.event_count,
         sample_count = sample_count + 1,
         error_count = error_count + excluded.error_count,
         latency_sum_ms = latency_sum_ms + excluded.latency_sum_ms,
         latency_max_ms = MAX(latency_max_ms, excluded.latency_max_ms),
         latency_le_100 = latency_le_100 + excluded.latency_le_100,
         latency_le_250 = latency_le_250 + excluded.latency_le_250,
         latency_le_500 = latency_le_500 + excluded.latency_le_500,
         latency_le_1000 = latency_le_1000 + excluded.latency_le_1000,
         latency_le_2500 = latency_le_2500 + excluded.latency_le_2500,
         latency_le_5000 = latency_le_5000 + excluded.latency_le_5000,
         latency_gt_5000 = latency_gt_5000 + excluded.latency_gt_5000,
         updated_at = datetime('now')`,
    )
    .bind(
      input.guildKey,
      hourBucket(input.at ?? new Date()),
      input.module,
      input.operation,
      input.outcome,
      weight,
      input.outcome === "error" ? weight : 0,
      durationMs * weight,
      durationMs,
      ...h,
    )
    .run();
}

export interface HealthMetricRow {
  module: TelemetryModule;
  eventCount: number;
  sampleCount: number;
  errorCount: number;
  latencyLe100: number;
  latencyLe250: number;
  latencyLe500: number;
  latencyLe1000: number;
  latencyLe2500: number;
  latencyLe5000: number;
  latencyGt5000: number;
  lastObservedAt: string;
}

export async function listHealthMetrics(
  db: D1Database,
  guildKey: string,
  hours = 24,
): Promise<HealthMetricRow[]> {
  return (
    await db
      .prepare(
        `SELECT module,
                SUM(event_count) AS eventCount,
                SUM(sample_count) AS sampleCount,
                SUM(error_count) AS errorCount,
                SUM(latency_le_100) AS latencyLe100,
                SUM(latency_le_250) AS latencyLe250,
                SUM(latency_le_500) AS latencyLe500,
                SUM(latency_le_1000) AS latencyLe1000,
                SUM(latency_le_2500) AS latencyLe2500,
                SUM(latency_le_5000) AS latencyLe5000,
                SUM(latency_gt_5000) AS latencyGt5000,
                MAX(bucket) AS lastObservedAt
         FROM operation_metrics
         WHERE guild_key = ?1 AND bucket >= strftime('%Y-%m-%dT%H:00:00Z', 'now', ?2)
         GROUP BY module ORDER BY module`,
      )
      .bind(guildKey, `-${Math.max(1, Math.min(168, hours))} hours`)
      .all<HealthMetricRow>()
  ).results;
}

// --- Studio observability (M15): cross-guild aggregation for dashboards. Reads
// only the pseudonymized `guild_key` — no raw guild id / PII ever surfaces. ---

export interface StudioMetricRow {
  module: string;
  events: number;
  samples: number;
  errors: number;
  latencyLe100: number;
  latencyLe250: number;
  latencyLe500: number;
  latencyLe1000: number;
  latencyLe2500: number;
  latencyLe5000: number;
  latencyGt5000: number;
  lastObservedAt: string | null;
}

/** Cross-guild metrics per module over the last `hours` (1..168). */
export async function aggregateMetricsForStudio(db: D1Database, hours = 24): Promise<StudioMetricRow[]> {
  const h = Math.max(1, Math.min(168, Math.round(hours)));
  return (
    await db
      .prepare(
        `SELECT module,
                SUM(event_count) AS events,
                SUM(sample_count) AS samples,
                SUM(error_count) AS errors,
                SUM(latency_le_100) AS latencyLe100,
                SUM(latency_le_250) AS latencyLe250,
                SUM(latency_le_500) AS latencyLe500,
                SUM(latency_le_1000) AS latencyLe1000,
                SUM(latency_le_2500) AS latencyLe2500,
                SUM(latency_le_5000) AS latencyLe5000,
                SUM(latency_gt_5000) AS latencyGt5000,
                MAX(bucket) AS lastObservedAt
           FROM operation_metrics
          WHERE bucket >= strftime('%Y-%m-%dT%H:00:00Z', 'now', ?1)
          GROUP BY module ORDER BY errors DESC, events DESC`,
      )
      .bind(`-${h} hours`)
      .all<StudioMetricRow>()
  ).results;
}

export interface StudioErrorRow {
  module: string;
  operation: string;
  errors: number;
  events: number;
}

/** Top (module, operation) pairs by error count over the window. */
export async function topErrorsForStudio(db: D1Database, hours = 24, limit = 20): Promise<StudioErrorRow[]> {
  const h = Math.max(1, Math.min(168, Math.round(hours)));
  const lim = Math.max(1, Math.min(100, Math.round(limit)));
  return (
    await db
      .prepare(
        `SELECT module, operation,
                SUM(error_count) AS errors,
                SUM(event_count) AS events
           FROM operation_metrics
          WHERE bucket >= strftime('%Y-%m-%dT%H:00:00Z', 'now', ?1) AND error_count > 0
          GROUP BY module, operation
          ORDER BY errors DESC LIMIT ?2`,
      )
      .bind(`-${h} hours`, lim)
      .all<StudioErrorRow>()
  ).results;
}

export async function purgeObservabilityMetrics(db: D1Database, retentionDays = 30): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM operation_metrics WHERE bucket < strftime('%Y-%m-%dT%H:00:00Z', 'now', ?1)`)
    .bind(`-${Math.max(1, Math.min(90, retentionDays))} days`)
    .run();
  return result.meta.changes ?? 0;
}
