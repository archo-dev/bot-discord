import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import type { TelemetryVariables } from "./request.js";

const eventNames = ["app_boot_failed", "chunk_load_failed", "api_request_failed", "session_expired", "error_boundary_triggered", "recovery_reload_triggered"] as const;
const categories = ["render", "chunk", "network", "timeout", "http", "invalid_response", "session", "boot"] as const;

const clientEventSchema = z.object({
  event: z.enum(eventNames),
  diagnosticId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  category: z.enum(categories),
  buildVersion: z.string().min(1).max(64),
  route: z.string().regex(/^\/[A-Za-z0-9_/:.-]*$/).max(160),
  status: z.number().int().min(0).max(599).optional(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  zone: z.enum(["root", "client", "guild", "modules", "automations", "subscription"]).optional(),
  errorType: z.enum(["error", "type_error", "reference_error", "unknown"]).optional(),
}).strict();

export function browserFamily(userAgent: string | undefined): "chrome" | "firefox" | "safari" | "edge" | "other" {
  if (!userAgent) return "other";
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/Chrome\//.test(userAgent)) return "chrome";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
}

export const frontendTelemetryRouter = new Hono<{ Bindings: Env; Variables: TelemetryVariables }>();

frontendTelemetryRouter.post("/telemetry/frontend", async (c) => {
  const parsed = clientEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const event = parsed.data;
  // Closed schema only: never log the user, raw URL/query, error text, cookies or payload data.
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    source: "panel",
    requestId: c.get("requestId"),
    diagnosticId: event.diagnosticId,
    event: event.event,
    category: event.category,
    buildVersion: event.buildVersion,
    route: event.route,
    browser: browserFamily(c.req.header("user-agent")),
    ...(event.status === undefined ? {} : { status: event.status }),
    ...(event.requestId === undefined ? {} : { apiRequestId: event.requestId }),
    ...(event.zone === undefined ? {} : { zone: event.zone }),
    ...(event.errorType === undefined ? {} : { errorType: event.errorType }),
  }));
  return c.body(null, 204);
});
