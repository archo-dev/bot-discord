/**
 * Observability contract shared by Worker, Gateway and panel.
 *
 * Privacy rule: this module deliberately has no free-form metadata field. Never
 * add message content, usernames, channel names, URLs, tokens, IPs or raw error
 * messages to these structures.
 */

export const TELEMETRY_MODULES = [
  "core",
  "auth",
  "interactions",
  "commands",
  "moderation",
  "tickets",
  "roles",
  "welcome",
  "automod",
  "levels",
  "starboard",
  "temp_voice",
  "music",
  "voice_logs",
  "stats",
  "gateway",
  "cron",
] as const;

export type TelemetryModule = (typeof TELEMETRY_MODULES)[number];

export const TELEMETRY_OPERATIONS = [
  "read",
  "write",
  "interaction",
  "internal",
  "heartbeat",
  "discord_rest",
  "scheduled",
] as const;

export type TelemetryOperation = (typeof TELEMETRY_OPERATIONS)[number];
export type TelemetryOutcome = "success" | "error";
export type TelemetryLogLevel = "info" | "warn" | "error";

export interface StructuredTelemetryEvent {
  requestId: string;
  module: TelemetryModule;
  operation: TelemetryOperation;
  outcome: TelemetryOutcome;
  /** Non-reversible, deployment-specific pseudonym; never a raw Discord ID. */
  guildKey?: string;
  durationMs?: number;
  /** Stable allowlisted category, never Error.message or a response body. */
  errorCode?: string;
  status?: number;
  source: "worker" | "gateway";
}

/**
 * Reliable-delivery outbox health (M05). Bounded aggregates only — never a
 * payload or Discord identifier. Optional on the heartbeat so an old gateway
 * (no outbox) and an old Worker (ignores the field) stay compatible.
 */
export interface GatewayDeliveryRuntime {
  enabled: boolean;
  running: boolean;
  pending: number;
  dead: number;
  oldestAgeSeconds: number;
  bytes: number;
  added: number;
  dropped: number;
  delivered: number;
  duplicates: number;
  retries: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
}

export interface GatewayHeartbeatRuntime {
  version: string;
  uptimeSeconds: number;
  memoryRssMb: number;
  voiceLogQueueDepth: number;
  channelActivityQueueDepth: number;
  errorsSinceLastHeartbeat: number;
  /** Reliable delivery (M05); absent on gateways without the outbox. */
  delivery?: GatewayDeliveryRuntime;
}

export type HealthState = "operational" | "degraded" | "inactive" | "unavailable";

export interface ModuleHealthDto {
  module: TelemetryModule;
  state: HealthState;
  estimatedEvents: number;
  sampledEvents: number;
  errors: number;
  successRate: number | null;
  approximateP95Ms: number | null;
  lastObservedAt: string | null;
}

export interface GatewayHealthDto {
  state: HealthState;
  lastHeartbeatAt: string | null;
  heartbeatAgeSeconds: number | null;
  guildCount: number | null;
  wsPingMs: number | null;
  runtime: GatewayHeartbeatRuntime | null;
}

export interface SloStatusDto {
  id: "api_availability" | "api_latency" | "gateway_freshness" | "interaction_success";
  label: string;
  state: HealthState;
  target: string;
  value: string;
}

export interface GuildHealthResponse {
  requestId: string;
  generatedAt: string;
  windowHours: 24;
  gateway: GatewayHealthDto;
  modules: ModuleHealthDto[];
  slos: SloStatusDto[];
  retentionDays: 30;
  /** Success traffic is sampled and weighted; errors are always recorded. */
  sampled: true;
}

/** Maps an unknown failure to a stable non-sensitive category. */
export function telemetryErrorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (error instanceof TypeError) return "network_error";
  if (error && typeof error === "object") {
    const status = "status" in error && typeof error.status === "number" ? error.status : null;
    if (status !== null && status >= 400 && status <= 599) return `http_${status}`;
  }
  return "internal_error";
}

/** JSON logger with an intentionally closed schema. */
export function logTelemetry(level: TelemetryLogLevel, event: StructuredTelemetryEvent): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    requestId: event.requestId,
    module: event.module,
    operation: event.operation,
    outcome: event.outcome,
    ...(event.guildKey ? { guildKey: event.guildKey } : {}),
    ...(event.durationMs !== undefined ? { durationMs: Math.max(0, Math.round(event.durationMs)) } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    ...(event.status !== undefined ? { status: event.status } : {}),
    source: event.source,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
