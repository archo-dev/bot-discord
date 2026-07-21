/** Observability & rollout DTOs (M15). Studio dashboards read aggregated,
 * already-pseudonymized metrics (no raw guild id / PII ever crosses this
 * boundary). Cohort rollout resolution is PURE so it can never drift between
 * worker and studio and is testable without I/O. */

/** Per-module aggregated metrics over a window (cross-guild, pseudonymized). */
export interface StudioMetricsSummary {
  module: string;
  events: number;
  errors: number;
  /** errors / events, 0..1 (0 when no events). */
  errorRate: number;
  latencyLe100: number;
  latencyLe250: number;
  latencyLe500: number;
  latencyLe1000: number;
  latencyLe2500: number;
  latencyLe5000: number;
  latencyGt5000: number;
  lastObservedAt: string | null;
}

export interface StudioMetricsResponse {
  windowHours: number;
  totalEvents: number;
  totalErrors: number;
  modules: StudioMetricsSummary[];
}

export interface StudioErrorBucket {
  module: string;
  operation: string;
  errors: number;
  events: number;
}

export interface StudioErrorsResponse {
  windowHours: number;
  items: StudioErrorBucket[];
}

export type ComponentStatus = "up" | "degraded" | "down";

export interface PublicStatusComponent {
  name: "worker" | "gateway" | "d1" | "kv";
  status: ComponentStatus;
  /** Only for gateway: seconds since the last heartbeat, or null if none. */
  heartbeatAgeSeconds?: number | null;
}

export interface PublicStatus {
  status: ComponentStatus;
  components: PublicStatusComponent[];
  observedAt: string;
}

/** Rollout state of one platform flag: global toggle + a pilot-guild cohort. */
export interface RolloutFlagState {
  flag: string;
  global: boolean;
  guilds: string[];
}

export interface RolloutResponse {
  flags: RolloutFlagState[];
}

/**
 * Pure cohort rollout resolution: a flag is on for a guild when it is globally
 * on, OR the guild is in the pilot cohort. Deterministic, no I/O.
 */
export function resolveRollout(input: { globalOn: boolean; cohortGuilds: readonly string[]; guildId?: string | null }): boolean {
  if (input.globalOn) return true;
  return input.guildId != null && input.cohortGuilds.includes(input.guildId);
}
