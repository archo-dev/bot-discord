import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env.js";
import { isHttpsEnvironment } from "../security/browser.js";
import {
  createOAuthStateCookieValue,
  createOAuthStateValue,
  OAUTH_STATE_MAX_AGE_SECONDS,
  validateOAuthStateValue,
  type OAuthStateValidation,
} from "./oauth-state.js";

/**
 * Studio session store (M12) — a strict, isolated replica of the client session
 * model (auth/session.ts). Deliberately DISTINCT from the client surface:
 *   - cookie name `studio_session` (never `session`), `sameSite=Strict`
 *   - KV keyspace `studio:sess:<id>` (never `sess:`)
 *   - shorter TTLs (8 h absolute / 30 min idle) — a compromised operator session
 *     expires fast (doc 09 §2, E2 Fiche 7.1)
 *   - its own kill-switch `STUDIO_SESSION_GLOBAL_VERSION`
 * The client cookie can never open the Studio and vice-versa.
 */

export const STUDIO_SESSION_COOKIE = "studio_session";
export const STUDIO_OAUTH_STATE_COOKIE = "studio_oauth_state";
export const STUDIO_STEPUP_STATE_COOKIE = "studio_stepup_state";
const STUDIO_ABSOLUTE_SECONDS = 8 * 3600;
const STUDIO_IDLE_MS = 30 * 60_000;
const STUDIO_TOUCH_MS = 5 * 60_000;

export interface StudioSessionData {
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
  userGeneration: number;
  globalVersion: string;
  /** epoch ms of the last OAuth re-consent (step-up), for sensitive actions (M14). */
  stepUpAt?: number;
}

export type StudioSessionInput = Pick<StudioSessionData, "userId" | "username" | "globalName" | "avatar" | "createdAt"> & {
  /** epoch ms when the Discord access token expires (bounds the absolute TTL). */
  tokenExpiresAt: number;
};

export type StudioSessionLoadResult = { session: StudioSessionData | null; reason: "missing" | "expired" | "revoked" | null };

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function operatorGeneration(env: Env, userId: string): Promise<number> {
  return Number((await env.KV.get(`security:session-generation:${userId}`)) ?? "0") || 0;
}

function globalVersion(env: Env): string {
  return env.STUDIO_SESSION_GLOBAL_VERSION ?? "1";
}

export async function createStudioSession(env: Env, data: StudioSessionInput): Promise<string> {
  const id = randomId();
  const now = Date.now();
  const session: StudioSessionData = {
    userId: data.userId,
    username: data.username,
    globalName: data.globalName,
    avatar: data.avatar,
    createdAt: data.createdAt,
    lastSeenAt: now,
    absoluteExpiresAt: Math.min(now + STUDIO_ABSOLUTE_SECONDS * 1000, data.tokenExpiresAt),
    userGeneration: await operatorGeneration(env, data.userId),
    globalVersion: globalVersion(env),
  };
  const ttl = Math.max(60, Math.ceil((session.absoluteExpiresAt - now) / 1000));
  await env.KV.put(`studio:sess:${id}`, JSON.stringify(session), { expirationTtl: ttl });
  return id;
}

export async function loadStudioSession(env: Env, id: string): Promise<StudioSessionLoadResult> {
  if (!/^[0-9a-f]{64}$/.test(id)) return { session: null, reason: "missing" };
  const raw = await env.KV.get(`studio:sess:${id}`);
  if (!raw) return { session: null, reason: "missing" };
  let session: StudioSessionData;
  try {
    session = JSON.parse(raw) as StudioSessionData;
  } catch {
    await deleteStudioSession(env, id);
    return { session: null, reason: "revoked" };
  }
  const now = Date.now();
  if (session.absoluteExpiresAt <= now || now - session.lastSeenAt > STUDIO_IDLE_MS) {
    await deleteStudioSession(env, id);
    return { session: null, reason: "expired" };
  }
  const generation = await operatorGeneration(env, session.userId);
  if (session.userGeneration !== generation || session.globalVersion !== globalVersion(env)) {
    await deleteStudioSession(env, id);
    return { session: null, reason: "revoked" };
  }
  if (now - session.lastSeenAt >= STUDIO_TOUCH_MS) {
    session.lastSeenAt = now;
    await env.KV.put(`studio:sess:${id}`, JSON.stringify(session), {
      expirationTtl: Math.max(60, Math.ceil((session.absoluteExpiresAt - now) / 1000)),
    });
  }
  return { session, reason: null };
}

export async function deleteStudioSession(env: Env, id: string): Promise<void> {
  await env.KV.delete(`studio:sess:${id}`);
}

/**
 * Stamp a fresh step-up (OAuth re-consent) time on an existing session (M14).
 * Preserves the session's remaining TTL. No-op if the session is gone.
 */
export async function markStudioStepUp(env: Env, id: string): Promise<boolean> {
  const raw = await env.KV.get(`studio:sess:${id}`);
  if (!raw) return false;
  let session: StudioSessionData;
  try {
    session = JSON.parse(raw) as StudioSessionData;
  } catch {
    return false;
  }
  const now = Date.now();
  if (session.absoluteExpiresAt <= now) return false;
  session.stepUpAt = now;
  await env.KV.put(`studio:sess:${id}`, JSON.stringify(session), {
    expirationTtl: Math.max(60, Math.ceil((session.absoluteExpiresAt - now) / 1000)),
  });
  return true;
}

export async function revokeStudioSessions(env: Env, userId: string): Promise<void> {
  const next = (await operatorGeneration(env, userId)) + 1;
  await env.KV.put(`security:session-generation:${userId}`, String(next), { expirationTtl: 30 * 24 * 3600 });
}

export function setStudioSessionCookie(c: Context, id: string): void {
  setCookie(c, STUDIO_SESSION_COOKIE, id, {
    httpOnly: true,
    secure: isHttpsEnvironment(c.env as Env),
    sameSite: "Strict",
    path: "/",
    maxAge: STUDIO_ABSOLUTE_SECONDS,
  });
}

export function clearStudioSessionCookie(c: Context): void {
  deleteCookie(c, STUDIO_SESSION_COOKIE, { path: "/" });
}

export function readStudioSessionCookie(c: Context): string | undefined {
  return getCookie(c, STUDIO_SESSION_COOKIE);
}

async function setStudioStateCookie(
  c: Context,
  name: string,
  path: string,
  purpose: "studio" | "studio-step-up",
  state: string,
  issuedAt: number,
): Promise<void> {
  const value = await createOAuthStateCookieValue((c.env as Env).SESSION_SECRET, purpose, state, issuedAt);
  setCookie(c, name, value, {
    httpOnly: true,
    secure: isHttpsEnvironment(c.env as Env),
    sameSite: "Lax",
    path,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export function setStudioOAuthStateCookie(c: Context, state: string, issuedAt = Date.now()): Promise<void> {
  return setStudioStateCookie(c, STUDIO_OAUTH_STATE_COOKIE, "/studio/auth/callback", "studio", state, issuedAt);
}

export function readStudioOAuthStateCookie(c: Context): string | undefined {
  return getCookie(c, STUDIO_OAUTH_STATE_COOKIE);
}

export function clearStudioOAuthStateCookie(c: Context): void {
  deleteCookie(c, STUDIO_OAUTH_STATE_COOKIE, { path: "/studio/auth/callback" });
}

export function createStudioOAuthState(): string {
  return createOAuthStateValue();
}

export function validateStudioOAuthState(
  env: Env,
  state: string | undefined,
  cookieState: string | undefined,
  now = Date.now(),
): Promise<OAuthStateValidation> {
  return validateOAuthStateValue(env.SESSION_SECRET, "studio", state, cookieState, now);
}

export function setStudioStepUpStateCookie(c: Context, state: string, issuedAt = Date.now()): Promise<void> {
  return setStudioStateCookie(
    c,
    STUDIO_STEPUP_STATE_COOKIE,
    "/studio/auth/step-up/callback",
    "studio-step-up",
    state,
    issuedAt,
  );
}

export function readStudioStepUpStateCookie(c: Context): string | undefined {
  return getCookie(c, STUDIO_STEPUP_STATE_COOKIE);
}

export function clearStudioStepUpStateCookie(c: Context): void {
  deleteCookie(c, STUDIO_STEPUP_STATE_COOKIE, { path: "/studio/auth/step-up/callback" });
}

export function validateStudioStepUpState(
  env: Env,
  state: string | undefined,
  cookieState: string | undefined,
  now = Date.now(),
): Promise<OAuthStateValidation> {
  return validateOAuthStateValue(env.SESSION_SECRET, "studio-step-up", state, cookieState, now);
}
