/** Compteurs agrégés du mode SHADOW d'enforcement des plans. Raw SQL only.
 *  Dimensions BORNÉES uniquement (enums + compteur) — jamais de PII. Table
 *  0041_capability_shadow_metrics. L'upsert incrémente atomiquement le compteur. */

import type {
  CapabilityId,
  CapabilityReason,
  CapabilitySurface,
  PlanId,
} from "@bot/shared";

export interface CapabilityMetricDims {
  surface: CapabilitySurface;
  capability: CapabilityId;
  effectivePlan: PlanId;
  requiredPlan: PlanId;
  reason: CapabilityReason;
  decision: "allowed" | "would_block";
}

/** Incrémente (upsert) un compteur pour le jour courant. `by` ≥ 1. */
export async function incrementCapabilityMetric(
  db: D1Database,
  dims: CapabilityMetricDims,
  by = 1,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db
    .prepare(
      `INSERT INTO capability_shadow_metrics
         (day, surface, capability, effective_plan, required_plan, reason, decision, count)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (day, surface, capability, effective_plan, required_plan, reason, decision)
       DO UPDATE SET count = count + ?8`,
    )
    .bind(day, dims.surface, dims.capability, dims.effectivePlan, dims.requiredPlan, dims.reason, dims.decision, Math.max(1, by))
    .run();
}

/** Applique un lot de compteurs (batch Gateway) en une transaction bornée. */
export async function incrementCapabilityMetricsBatch(
  db: D1Database,
  items: readonly (CapabilityMetricDims & { count: number })[],
): Promise<void> {
  if (items.length === 0) return;
  const day = new Date().toISOString().slice(0, 10);
  const stmt = db.prepare(
    `INSERT INTO capability_shadow_metrics
       (day, surface, capability, effective_plan, required_plan, reason, decision, count)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (day, surface, capability, effective_plan, required_plan, reason, decision)
     DO UPDATE SET count = count + ?8`,
  );
  await db.batch(
    items.map((it) =>
      stmt.bind(day, it.surface, it.capability, it.effectivePlan, it.requiredPlan, it.reason, it.decision, Math.max(1, it.count)),
    ),
  );
}

export interface CapabilityShadowMetricRow {
  surface: string;
  capability: string;
  effective_plan: string;
  required_plan: string;
  reason: string;
  decision: string;
  count: number;
}

/** Agrège les compteurs des N derniers jours (fenêtre bornée) pour le Studio. */
export async function aggregateCapabilityShadow(
  db: D1Database,
  days: number,
): Promise<CapabilityShadowMetricRow[]> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString().slice(0, 10);
  const res = await db
    .prepare(
      `SELECT surface, capability, effective_plan, required_plan, reason, decision,
              SUM(count) AS count
         FROM capability_shadow_metrics
        WHERE day >= ?1
        GROUP BY surface, capability, effective_plan, required_plan, reason, decision
        ORDER BY count DESC`,
    )
    .bind(since)
    .all<CapabilityShadowMetricRow>();
  return res.results ?? [];
}
