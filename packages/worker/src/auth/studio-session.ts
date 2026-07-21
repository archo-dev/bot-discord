import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env.js";
import { isHttpsEnvironment } from "../security/browser.js";

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

export function setStudioOAuthStateCookie(c: Context, state: string): void {
  setCookie(c, STUDIO_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isHttpsEnvironment(c.env as Env),
    sameSite: "Lax",
    path: "/studio/auth/callback",
    maxAge: 300,
  });
}

export function readStudioOAuthStateCookie(c: Context): string | undefined {
  return getCookie(c, STUDIO_OAUTH_STATE_COOKIE);
}

export function clearStudioOAuthStateCookie(c: Context): void {
  deleteCookie(c, STUDIO_OAUTH_STATE_COOKIE, { path: "/studio/auth/callback" });
}

export async function createStudioOAuthState(env: Env): Promise<string> {
  const state = randomId();
  await env.KV.put(`studio:oauthstate:${state}`, "1", { expirationTtl: 300 });
  return state;
}

export async function consumeStudioOAuthState(env: Env, state: string, cookieState: string | undefined): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(state) || cookieState !== state) return false;
  const found = await env.KV.get(`studio:oauthstate:${state}`);
  if (!found) return false;
  await env.KV.delete(`studio:oauthstate:${state}`);
  return true;
}
