import type { MiddlewareHandler } from "hono";
import type { TelemetryModule, TelemetryOperation } from "@bot/shared";
import type { Env } from "../env.js";
import { logTelemetry } from "./logger.js";
import { recordOperationMetric } from "../db/queries.js";

export interface TelemetryVariables {
  requestId: string;
  guildKey?: string;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SNOWFLAKE = /^\d{5,20}$/;

const MODULE_SEGMENTS: Record<string, TelemetryModule> = {
  commands: "commands",
  "mod-actions": "moderation",
  warnings: "moderation",
  tickets: "tickets",
  "button-roles": "roles",
  roles: "roles",
  welcome: "welcome",
  "log-settings": "welcome",
  automod: "automod",
  "xp-settings": "levels",
  leaderboard: "levels",
  "starboard-settings": "starboard",
  starboard: "starboard",
  "temp-voice-settings": "temp_voice",
  "temp-voice": "temp_voice",
  "music-state": "music",
  "music-control": "music",
  playlists: "music",
  "voice-logs": "voice_logs",
  stats: "stats",
};

export interface ClassifiedRequest {
  module: TelemetryModule;
  operation: TelemetryOperation;
  guildId?: string;
}

/** Converts a URL into bounded dimensions; raw paths are never logged/stored. */
export function classifyRequest(method: string, pathname: string): ClassifiedRequest | null {
  if (pathname === "/health") return { module: "core", operation: "read" };
  if (pathname === "/interactions") return { module: "interactions", operation: "interaction" };
  if (pathname.startsWith("/auth/")) return { module: "auth", operation: method === "GET" ? "read" : "write" };
  if (!pathname.startsWith("/api/") && !pathname.startsWith("/internal/")) return null;

  const parts = pathname.split("/").filter(Boolean);
  const isInternal = parts[0] === "internal";
  const guildIndex = parts.indexOf("guilds") + 1;
  const guildId = guildIndex > 0 && SNOWFLAKE.test(parts[guildIndex] ?? "") ? parts[guildIndex] : undefined;
  const featureIndex = guildId ? guildIndex + 1 : isInternal ? 1 : 1;
  const feature = parts[featureIndex] ?? "";
  const module = isInternal && pathname.includes("/gateway/heartbeat") ? "gateway" : (MODULE_SEGMENTS[feature] ?? "core");
  const operation: TelemetryOperation = isInternal ? (feature === "gateway" ? "heartbeat" : "internal") : method === "GET" || method === "HEAD" ? "read" : "write";
  return { module, operation, ...(guildId ? { guildId } : {}) };
}

export function acceptedRequestId(value: string | undefined): string {
  return value && SAFE_REQUEST_ID.test(value) ? value : crypto.randomUUID();
}

/** Success logs are sampled to keep log volume bounded; failures are never sampled. */
export function shouldLogSuccess(random = Math.random()): boolean {
  return random < 0.1;
}

export function metricSampleWeight(outcome: "success" | "error", random = Math.random()): number | null {
  if (outcome === "error") return 1;
  return random < 0.25 ? 4 : null;
}

async function interactionGuildId(request: Request): Promise<string | undefined> {
  try {
    // Only the guild_id scalar is inspected. The cloned payload is never logged,
    // stored or returned and remains subject to Discord signature validation.
    const body = (await request.clone().json()) as { guild_id?: unknown };
    return typeof body.guild_id === "string" && SNOWFLAKE.test(body.guild_id) ? body.guild_id : undefined;
  } catch {
    return undefined;
  }
}

/** Deployment-specific pseudonym. The raw guild ID never leaves request scope. */
export async function pseudonymizeGuild(secret: string, guildId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`m01:${secret}:${guildId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const requestTelemetry: MiddlewareHandler<{
  Bindings: Env;
  Variables: TelemetryVariables;
}> = async (c, next) => {
  const classified = classifyRequest(c.req.method, new URL(c.req.url).pathname);
  if (!classified) {
    await next();
    return;
  }

  const requestId = acceptedRequestId(c.req.header("x-request-id"));
  const guildId = classified.guildId ?? (classified.operation === "interaction" ? await interactionGuildId(c.req.raw) : undefined);
  const guildKey = guildId ? await pseudonymizeGuild(c.env.SESSION_SECRET, guildId) : undefined;
  c.set("requestId", requestId);
  if (guildKey) c.set("guildKey", guildKey);
  c.header("x-request-id", requestId);
  const started = performance.now();

  try {
    await next();
  } catch (error) {
    logTelemetry("error", {
      requestId,
      module: classified.module,
      operation: classified.operation,
      outcome: "error",
      ...(guildKey ? { guildKey } : {}),
      durationMs: performance.now() - started,
      errorCode: "unhandled_error",
      status: 500,
      source: "worker",
    });
    throw error;
  }

  const status = c.res.status;
  const outcome = status < 400 ? "success" : "error";
  const durationMs = performance.now() - started;
  const weight = guildKey ? metricSampleWeight(outcome) : null;
  if (guildKey && weight !== null) {
    c.executionCtx.waitUntil(
      recordOperationMetric(c.env.DB, {
        guildKey,
        module: classified.module,
        operation: classified.operation,
        outcome,
        durationMs,
        weight,
      }).catch(() =>
        logTelemetry("error", {
          requestId,
          module: "core",
          operation: "write",
          outcome: "error",
          guildKey,
          errorCode: "metrics_write_failed",
          source: "worker",
        }),
      ),
    );
  }
  if (outcome === "success" && !shouldLogSuccess()) return;
  logTelemetry(outcome === "error" ? "warn" : "info", {
    requestId,
    module: classified.module,
    operation: classified.operation,
    outcome,
    ...(guildKey ? { guildKey } : {}),
    durationMs,
    ...(outcome === "error" ? { errorCode: `http_${status}` } : {}),
    status,
    source: "worker",
  });
};
