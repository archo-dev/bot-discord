import { normalizeTelemetryRoute } from "./resilience.js";

export type ClientEventName =
  | "app_boot_failed"
  | "chunk_load_failed"
  | "api_request_failed"
  | "session_expired"
  | "error_boundary_triggered"
  | "recovery_reload_triggered";

export type ClientErrorCategory = "render" | "chunk" | "network" | "timeout" | "http" | "invalid_response" | "session" | "boot";

export interface ClientEvent {
  event: ClientEventName;
  diagnosticId: string;
  category: ClientErrorCategory;
  status?: number;
  requestId?: string;
  zone?: string;
  errorType?: "error" | "type_error" | "reference_error" | "unknown";
}

export const BUILD_VERSION = (import.meta.env.VITE_BUILD_VERSION || "development").slice(0, 64);
const lastReports = new Map<string, number>();
let reportCount = 0;

export function classifyClientErrorType(error: unknown): NonNullable<ClientEvent["errorType"]> {
  if (error instanceof TypeError) return "type_error";
  if (error instanceof ReferenceError) return "reference_error";
  if (error instanceof Error) return "error";
  return "unknown";
}

export function claimClientEvent(event: ClientEventName, now = Date.now()): boolean {
  if (reportCount >= 20) return false;
  const last = lastReports.get(event) ?? 0;
  if (now - last < 5_000) return false;
  lastReports.set(event, now);
  reportCount++;
  return true;
}

/** Fire-and-forget and deliberately isolated from api(): telemetry failure must never recurse. */
export function reportClientEvent(event: ClientEvent): void {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;
  if (!claimClientEvent(event.event)) return;
  const body = {
    ...event,
    diagnosticId: event.diagnosticId.slice(0, 64),
    ...(event.requestId ? { requestId: event.requestId.slice(0, 64) } : {}),
    ...(event.zone ? { zone: event.zone.slice(0, 32) } : {}),
    ...(event.errorType ? { errorType: event.errorType } : {}),
    buildVersion: BUILD_VERSION,
    route: normalizeTelemetryRoute(window.location.pathname),
  };
  void fetch("/telemetry/frontend", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": event.diagnosticId.slice(0, 64) },
    body: JSON.stringify(body),
    credentials: "omit",
    keepalive: true,
  }).catch(() => undefined);
}
