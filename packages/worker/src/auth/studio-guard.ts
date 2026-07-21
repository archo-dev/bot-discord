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

/** 404 unless the Studio is enabled AND the request lands on the studio host. */
export const requireStudioHost: MiddlewareHandler<StudioContext> = async (c, next) => {
  if (!studioEnabled(c.env) || requestHost(c.req.url) !== c.env.STUDIO_HOST) {
    return c.json({ error: "not_found" }, 404);
  }
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
