import { Hono } from "hono";
import type { ComponentStatus, PublicStatus, PublicStatusComponent } from "@bot/shared";
import type { Env } from "../env.js";

/**
 * Public status page (M15, D14 minimal). Reports component health only — never
 * PII, never a raw guild id, never internal detail. Not session-gated: it is an
 * operational read of Worker/Gateway/D1/KV liveness (doc 12 §9 smoke tests).
 */
export const statusRouter = new Hono<{ Bindings: Env }>();

const GATEWAY_STALE_SECONDS = 180;

statusRouter.get("/status", async (c) => {
  const components: PublicStatusComponent[] = [];

  // Worker: if this handler runs, the worker is up.
  components.push({ name: "worker", status: "up" });

  // Gateway: presence + freshness of the heartbeat KV key (written by /internal/gateway/heartbeat).
  const rawGateway = await c.env.KV.get("gateway:status");
  let gatewayStatus: ComponentStatus = "down";
  let heartbeatAgeSeconds: number | null = null;
  if (rawGateway) {
    let at: number | null = null;
    try {
      const parsed = JSON.parse(rawGateway) as { at?: number };
      at = typeof parsed.at === "number" ? parsed.at : null;
    } catch {
      at = null;
    }
    heartbeatAgeSeconds = at === null ? null : Math.max(0, Math.round((Date.now() - at) / 1000));
    gatewayStatus = heartbeatAgeSeconds !== null && heartbeatAgeSeconds > GATEWAY_STALE_SECONDS ? "degraded" : "up";
  }
  components.push({ name: "gateway", status: gatewayStatus, heartbeatAgeSeconds });

  // D1: a trivial query proves reachability.
  let d1: ComponentStatus = "down";
  try {
    await c.env.DB.prepare("SELECT 1").first();
    d1 = "up";
  } catch {
    d1 = "down";
  }
  components.push({ name: "d1", status: d1 });

  // KV: the heartbeat read above already exercised KV; treat a thrown read as down.
  let kv: ComponentStatus = "up";
  try {
    await c.env.KV.get("status:ping");
  } catch {
    kv = "down";
  }
  components.push({ name: "kv", status: kv });

  // Overall: worst-of. `down` on a core dependency → down; any degraded → degraded.
  const statuses = components.map((x) => x.status);
  const overall: ComponentStatus = statuses.includes("down") ? "down" : statuses.includes("degraded") ? "degraded" : "up";

  const body: PublicStatus = { status: overall, components, observedAt: new Date().toISOString() };
  c.header("cache-control", "no-store");
  return c.json(body);
});
