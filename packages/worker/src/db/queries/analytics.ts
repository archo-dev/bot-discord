import type { ProductMetricInput, ProductMetricSummary } from "@bot/shared";

export async function isProductAnalyticsEnabled(db: D1Database, guildId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT product_analytics_enabled FROM guild_privacy WHERE guild_id = ?1`,
  ).bind(guildId).first<{ product_analytics_enabled: number }>();
  return row?.product_analytics_enabled !== 0;
}

export async function getGuildPrivacy(db: D1Database, guildId: string): Promise<boolean> {
  return isProductAnalyticsEnabled(db, guildId);
}

export async function setGuildPrivacy(db: D1Database, guildId: string, enabled: boolean): Promise<void> {
  await db.prepare(
    `INSERT INTO guild_privacy (guild_id, product_analytics_enabled, updated_at)
     VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(guild_id) DO UPDATE SET product_analytics_enabled = excluded.product_analytics_enabled, updated_at = datetime('now')`,
  ).bind(guildId, enabled ? 1 : 0).run();
}

export async function deleteMetricContributions(db: D1Database, guildKeys: readonly string[]): Promise<number> {
  if (guildKeys.length === 0) return 0;
  const placeholders = guildKeys.map((_, index) => `?${index + 1}`).join(",");
  const result = await db.prepare(
    `DELETE FROM product_metric_contributions WHERE guild_key IN (${placeholders})`,
  ).bind(...guildKeys).run();
  return result.meta.changes;
}

export async function upsertMetricContribution(db: D1Database, input: ProductMetricInput & {
  day: string;
  guildKey: string;
  appVersion: string;
  cohortBucket: number;
}): Promise<void> {
  await db.prepare(
    `INSERT INTO product_metric_contributions
       (day, guild_key, event, module, step, outcome, app_version, cohort_bucket, count)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
     ON CONFLICT(day, guild_key, event, module, step, outcome, app_version)
     DO UPDATE SET count = count + 1`,
  ).bind(input.day, input.guildKey, input.event, input.module ?? "", input.step ?? "", input.outcome, input.appVersion, input.cohortBucket).run();
}

export async function insertProductFeedback(
  db: D1Database,
  guildId: string,
  category: string,
  message: string,
): Promise<{ id: number; createdAt: string }> {
  const result = await db.prepare(
    `INSERT INTO product_feedback (guild_id, category, message) VALUES (?1, ?2, ?3)`,
  ).bind(guildId, category, message).run();
  const id = Number(result.meta.last_row_id);
  const row = await db.prepare(`SELECT created_at FROM product_feedback WHERE id = ?1`).bind(id).first<{ created_at: string }>();
  return { id, createdAt: row!.created_at };
}

export async function listProductMetrics(db: D1Database, days: number): Promise<ProductMetricSummary[]> {
  const result = await db.prepare(
    `WITH combined AS (
       SELECT day, event, module, step, outcome, app_version, cohort_bucket, count, guild_count
         FROM product_metrics WHERE day >= date('now', ?1)
       UNION ALL
       SELECT day, event, module, step, outcome, app_version, cohort_bucket,
              SUM(count) AS count, COUNT(*) AS guild_count
         FROM product_metric_contributions
        WHERE day >= date('now', ?1)
        GROUP BY day, event, module, step, outcome, app_version, cohort_bucket
     )
     SELECT day, event, module, step, outcome, app_version, cohort_bucket,
            SUM(count) AS count, SUM(guild_count) AS guild_count
       FROM combined
      GROUP BY day, event, module, step, outcome, app_version, cohort_bucket
     HAVING SUM(guild_count) >= 3
      ORDER BY day DESC, event, module, step, outcome`,
  ).bind(`-${days} days`).all<{
    day: string; event: string; module: string; step: string; outcome: string; app_version: string;
    cohort_bucket: number; count: number; guild_count: number;
  }>();
  return result.results.map((row) => ({
    day: row.day, event: row.event, module: row.module || null, step: row.step || null,
    outcome: row.outcome, appVersion: row.app_version, cohortBucket: row.cohort_bucket,
    count: row.count, guildCount: row.guild_count,
  }));
}

export async function purgeProductAnalytics(db: D1Database): Promise<{ aggregated: number; contributions: number; metrics: number; feedback: number }> {
  const aggregate = db.prepare(
    `INSERT INTO product_metrics (day, event, module, step, outcome, app_version, cohort_bucket, count, guild_count)
     SELECT day, event, module, step, outcome, app_version, cohort_bucket, SUM(count), COUNT(*)
       FROM product_metric_contributions
      WHERE day < date('now', '-7 days')
      GROUP BY day, event, module, step, outcome, app_version, cohort_bucket
     ON CONFLICT(day, event, module, step, outcome, app_version, cohort_bucket)
     DO UPDATE SET count = excluded.count, guild_count = excluded.guild_count`,
  );
  const removeContributions = db.prepare(`DELETE FROM product_metric_contributions WHERE day < date('now', '-7 days')`);
  const removeMetrics = db.prepare(`DELETE FROM product_metrics WHERE day < date('now', '-180 days')`);
  const removeFeedback = db.prepare(`DELETE FROM product_feedback WHERE created_at < datetime('now', '-60 days')`);
  const results = await db.batch([aggregate, removeContributions, removeMetrics, removeFeedback]);
  return {
    aggregated: results[0]!.meta.changes,
    contributions: results[1]!.meta.changes,
    metrics: results[2]!.meta.changes,
    feedback: results[3]!.meta.changes,
  };
}
