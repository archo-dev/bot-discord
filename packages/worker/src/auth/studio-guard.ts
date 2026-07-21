import type { MiddlewareHandler } from "hono";
import { STUDIO_PERMISSIONS, type StudioPermission } from "@bot/shared";
import type { Env } from "../env.js";
import { getWorkerFlags } from "../config/flags.js";
import { getStudioOperator, listStudioOperatorPermissions } from "../db/queries.js";
import { loadStudioSession, readStudioSessionCookie, type StudioSessionData } from "./studio-session.js";
import type { TelemetryVariables } from "../telemetry/request.js";

/**
 * Studio dev-auth (M12) — the security core of the isolated Studio surface.
 * NEVER trusts the client: host isolation, a distinct session, operator allowlist
 * and per-permission checks are all enforced server-side (doc 09).
 *
 *  requireStudioHost   — 404 unless platform.studio is on AND Host == STUDIO_HOST.
 *                        Guarantees "zéro endpoint studio côté client".
 *  requireStudioSession— loads the studio_session cookie, resolves the operator
 *                        (owner bootstrap OR active row), 401/403 otherwise.
 *  requireDeveloper(p) — requireStudioSession + a specific granular permission.
 *  studioMutationOrigin— strict Origin allowlist (studio host) on write verbs.
 */

export interface StudioOperator {
  userId: string;
  displayName: string | null;
  isOwner: boolean;
  permissions: StudioPermission[];
}

export interface StudioVariables extends TelemetryVariables {
  studioSession: StudioSessionData & { id: string };
  operator: StudioOperator;
}

export type StudioContext = { Bindings: Env; Variables: StudioVariables };

/** Owner snowflakes from the bootstrap secret (STUDIO_OWNER_IDS), de-duplicated. */
function ownerIds(env: Env): Set<string> {
  return new Set(
    (env.STUDIO_OWNER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{5,20}$/.test(s)),
  );
}

/** Is the Studio surface enabled (flag on + STUDIO_HOST configured)? */
export function studioEnabled(env: Env): boolean {
  return getWorkerFlags(env)["platform.studio"] && !!env.STUDIO_HOST;
}

function requestHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * Resolve a Discord user to a Studio operator, or null if not eligible. Owner
 * bootstrap grants all permissions; a `disabled` row is treated as not eligible.
 */
export async function resolveOperator(env: Env, userId: string): Promise<StudioOperator | null> {
  if (ownerIds(env).has(userId)) {
    return { userId, displayName: null, isOwner: true, permissions: [...STUDIO_PERMISSIONS] };
  }
  const row = await getStudioOperator(env.DB, userId);
  if (!row || row.status !== "active") return null;
  const permissions = await listStudioOperatorPermissions(env.DB, userId);
  return { userId, displayName: row.display_name, isOwner: false, permissions };
}

/**
 * 404 unless the Studio is enabled AND the request lands on the studio host.
 * On the studio host, a set STUDIO_KILL_SWITCH short-circuits with 503 (immediate
 * disable, M14) — the client host stays 404 so nothing about the studio leaks.
 */
export const requireStudioHost: MiddlewareHandler<StudioContext> = async (c, next) => {
  if (!studioEnabled(c.env) || requestHost(c.req.url) !== c.env.STUDIO_HOST) {
    return c.json({ error: "not_found" }, 404);
  }
  if (c.env.STUDIO_KILL_SWITCH === "true") return c.json({ error: "studio_disabled" }, 503);
  await next();
};

/** Loads the studio session + resolves an eligible operator, else 401/403. */
export const requireStudioSession: MiddlewareHandler<StudioContext> = async (c, next) => {
  const sid = readStudioSessionCookie(c);
  const loaded = sid ? await loadStudioSession(c.env, sid) : { session: null, reason: "missing" as const };
  if (!sid || !loaded.session) {
    return c.json({ error: loaded.reason === "revoked" ? "session_revoked" : loaded.reason === "expired" ? "session_expired" : "unauthenticated" }, 401);
  }
  const operator = await resolveOperator(c.env, loaded.session.userId);
  if (!operator) return c.json({ error: "not_an_operator" }, 403);
  c.set("studioSession", { ...loaded.session, id: sid });
  c.set("operator", operator);
  await next();
};

/** requireStudioSession + a specific granular permission (owner always passes). */
export function requireDeveloper(permission: StudioPermission): MiddlewareHandler<StudioContext> {
  return async (c, next) => {
    const operator = c.get("operator");
    if (!operator) return c.json({ error: "unauthenticated" }, 401);
    if (!operator.isOwner && !operator.permissions.includes(permission)) {
      return c.json({ error: "forbidden", permission }, 403);
    }
    await next();
  };
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Strict same-origin check for studio mutations (studio host only). */
export const studioMutationOrigin: MiddlewareHandler<StudioContext> = async (c, next) => {
  if (!WRITE_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  const origin = c.req.header("origin");
  const expected = c.env.STUDIO_HOST ? `https://${c.env.STUDIO_HOST}` : null;
  if (!origin || origin !== expected) return c.json({ error: "csrf_rejected" }, 403);
  await next();
};

/** Freshness window for a step-up (OAuth re-consent) before a sensitive action. */
const STEP_UP_MAX_AGE_MS = 10 * 60_000;

/**
 * Require a recent step-up (re-authentication) on sensitive actions — lifetime,
 * and any financial workflow (M14). 403 `step_up_required` when the session has
 * no fresh re-consent; the operator obtains one via /studio/auth/step-up.
 */
export function requireStepUp(maxAgeMs: number = STEP_UP_MAX_AGE_MS): MiddlewareHandler<StudioContext> {
  return async (c, next) => {
    const session = c.get("studioSession");
    const stepUpAt = session?.stepUpAt ?? 0;
    if (!stepUpAt || Date.now() - stepUpAt > maxAgeMs) {
      return c.json({ error: "step_up_required" }, 403);
    }
    await next();
  };
}

/**
 * Per-operator, per-action KV rate limit (M14, doc 09 §6). Fixed window; the
 * counter key resets each window and rolls back between tests. 429 on overflow.
 */
export function studioActionRateLimit(action: string, max: number, windowSec: number): MiddlewareHandler<StudioContext> {
  return async (c, next) => {
    const operator = c.get("operator");
    if (operator) {
      const bucket = Math.floor(Date.now() / (windowSec * 1000));
      const key = `studio:rl:${action}:${operator.userId}:${bucket}`;
      const current = Number((await c.env.KV.get(key)) ?? "0") || 0;
      if (current >= max) return c.json({ error: "rate_limited", retryAfterSeconds: windowSec }, 429);
      await c.env.KV.put(key, String(current + 1), { expirationTtl: Math.max(60, windowSec) });
    }
    await next();
  };
}
