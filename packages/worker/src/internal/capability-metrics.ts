/** Batch de décisions shadow rapportées par la Gateway (choke C). Le Worker est
 *  le seul écrivain D1 : la Gateway POST des dimensions BORNÉES (enums + count),
 *  jamais de PII. Validation stricte : tout item invalide est rejeté (pas écrit). */

import { Hono } from "hono";
import { z } from "zod";
import { CAPABILITY_IDS, CAPABILITY_SURFACES } from "@bot/shared";
import type { Env } from "../env.js";
import { incrementCapabilityMetricsBatch } from "../db/queries.js";

export const internalCapabilityMetricsRouter = new Hono<{ Bindings: Env }>();

const PLAN = z.enum(["free", "premium", "business"]);
const REASON = z.enum([
  "allowed_by_plan", "plan_required", "quota_exceeded", "no_active_entitlement",
  "entitlement_scheduled", "entitlement_expired", "entitlement_revoked",
  "assignment_required", "feature_disabled",
]);

const itemSchema = z.object({
  surface: z.enum(CAPABILITY_SURFACES as unknown as [string, ...string[]]),
  capability: z.enum(CAPABILITY_IDS as unknown as [string, ...string[]]),
  effectivePlan: PLAN,
  requiredPlan: PLAN,
  reason: REASON,
  decision: z.enum(["allowed", "would_block"]),
  count: z.number().int().min(1).max(100_000),
});
const batchSchema = z.object({ items: z.array(itemSchema).max(500) });

internalCapabilityMetricsRouter.post("/internal/capability-metrics", async (c) => {
  const parsed = batchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  if (parsed.data.items.length === 0) return c.json({ ok: true, written: 0 });
  await incrementCapabilityMetricsBatch(
    c.env.DB,
    parsed.data.items.map((it) => ({
      surface: it.surface as never,
      capability: it.capability as never,
      effectivePlan: it.effectivePlan,
      requiredPlan: it.requiredPlan,
      reason: it.reason as never,
      decision: it.decision,
      count: it.count,
    })),
  );
  return c.json({ ok: true, written: parsed.data.items.length });
});
