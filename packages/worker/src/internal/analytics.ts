import { Hono } from "hono";
import type { ProductMetricsResponse } from "@bot/shared";
import type { Env } from "../env.js";
import { listProductMetrics } from "../db/queries.js";

export const internalAnalyticsRouter = new Hono<{ Bindings: Env }>();

internalAnalyticsRouter.get("/internal/product-metrics", async (c) => {
  const raw = Number(c.req.query("days") ?? "30");
  const days = Number.isInteger(raw) ? Math.min(180, Math.max(1, raw)) : 30;
  const body: ProductMetricsResponse = { privacyThreshold: 3, metrics: await listProductMetrics(c.env.DB, days) };
  return c.json(body);
});
