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

export const SESSION_COOKIE = "session";
export const OAUTH_STATE_COOKIE = "oauth_state";
const SESSION_ABSOLUTE_SECONDS = 24 * 3600;
const SESSION_IDLE_MS = 2 * 3600_000;
const SESSION_TOUCH_MS = 15 * 60_000;

export interface SessionData {
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  /** Required to re-verify MANAGE_GUILD through Discord's /users/@me/guilds. */
  accessToken: string;
  /** epoch ms when the Discord access token expires */
  tokenExpiresAt: number;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
  userGeneration: number;
  globalVersion: string;
}

export type SessionInput = Omit<SessionData, "lastSeenAt" | "absoluteExpiresAt" | "userGeneration" | "globalVersion"> & {
  /** Legacy input accepted but deliberately never persisted. */
  refreshToken?: string;
};

export type SessionLoadResult = { session: SessionData | null; reason: "missing" | "expired" | "revoked" | null };

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function userGeneration(env: Env, userId: string): Promise<number> {
  return Number((await env.KV.get(`security:session-generation:${userId}`)) ?? "0") || 0;
}

export async function createSession(env: Env, data: SessionInput): Promise<string> {
  const id = randomId();
  const now = Date.now();
  const { refreshToken: _discarded, ...minimal } = data;
  const session: SessionData = {
    ...minimal,
    createdAt: data.createdAt,
    lastSeenAt: now,
    absoluteExpiresAt: Math.min(now + SESSION_ABSOLUTE_SECONDS * 1000, data.tokenExpiresAt),
    userGeneration: await userGeneration(env, data.userId),
    globalVersion: env.SESSION_GLOBAL_VERSION ?? "1",
  };
  const ttl = Math.max(60, Math.ceil((session.absoluteExpiresAt - now) / 1000));
  await env.KV.put(`sess:${id}`, JSON.stringify(session), { expirationTtl: ttl });
  return id;
}

export async function loadSession(env: Env, id: string): Promise<SessionLoadResult> {
  if (!/^[0-9a-f]{64}$/.test(id)) return { session: null, reason: "missing" };
  const raw = await env.KV.get(`sess:${id}`);
  if (!raw) return { session: null, reason: "missing" };
  let legacy: Partial<SessionData> & Pick<SessionData, "userId" | "createdAt" | "tokenExpiresAt">;
  try {
    legacy = JSON.parse(raw) as typeof legacy;
  } catch {
    await deleteSession(env, id);
    return { session: null, reason: "revoked" };
  }
  const now = Date.now();
  const session = {
    ...legacy,
    lastSeenAt: legacy.lastSeenAt ?? legacy.createdAt,
    absoluteExpiresAt: legacy.absoluteExpiresAt ?? Math.min(legacy.createdAt + SESSION_ABSOLUTE_SECONDS * 1000, legacy.tokenExpiresAt),
    userGeneration: legacy.userGeneration ?? 0,
    globalVersion: legacy.globalVersion ?? "1",
  } as SessionData;
  if (session.tokenExpiresAt <= now || session.absoluteExpiresAt <= now || now - session.lastSeenAt > SESSION_IDLE_MS) {
    await deleteSession(env, id);
    return { session: null, reason: "expired" };
  }
  const generation = await userGeneration(env, session.userId);
  if (session.userGeneration !== generation || session.globalVersion !== (env.SESSION_GLOBAL_VERSION ?? "1")) {
    await deleteSession(env, id);
    return { session: null, reason: "revoked" };
  }
  if (now - session.lastSeenAt >= SESSION_TOUCH_MS) {
    session.lastSeenAt = now;
    await env.KV.put(`sess:${id}`, JSON.stringify(session), {
      expirationTtl: Math.max(60, Math.ceil((session.absoluteExpiresAt - now) / 1000)),
    });
  }
  return { session, reason: null };
}

export async function getSession(env: Env, id: string): Promise<SessionData | null> {
  return (await loadSession(env, id)).session;
}

export async function deleteSession(env: Env, id: string): Promise<void> {
  await env.KV.delete(`sess:${id}`);
}

export async function revokeUserSessions(env: Env, userId: string): Promise<void> {
  const next = (await userGeneration(env, userId)) + 1;
  await env.KV.put(`security:session-generation:${userId}`, String(next), { expirationTtl: 30 * 24 * 3600 });
}

export function setSessionCookie(c: Context, id: string): void {
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: isHttpsEnvironment(c.env as Env),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_ABSOLUTE_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function setOAuthStateCookie(c: Context, state: string, issuedAt = Date.now()): Promise<void> {
  const value = await createOAuthStateCookieValue((c.env as Env).SESSION_SECRET, "panel", state, issuedAt);
  setCookie(c, OAUTH_STATE_COOKIE, value, {
    httpOnly: true,
    secure: isHttpsEnvironment(c.env as Env),
    sameSite: "Lax",
    path: "/auth/callback",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export function readOAuthStateCookie(c: Context): string | undefined {
  return getCookie(c, OAUTH_STATE_COOKIE);
}

export function clearOAuthStateCookie(c: Context): void {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/auth/callback" });
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

/** CSRF state for the OAuth flow. */
export function createOAuthState(): string {
  return createOAuthStateValue();
}

export function validateOAuthState(
  env: Env,
  state: string | undefined,
  cookieState: string | undefined,
  now = Date.now(),
): Promise<OAuthStateValidation> {
  return validateOAuthStateValue(env.SESSION_SECRET, "panel", state, cookieState, now);
}
