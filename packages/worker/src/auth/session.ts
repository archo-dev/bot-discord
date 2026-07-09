import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env.js";

export const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface SessionData {
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the Discord access token expires */
  tokenExpiresAt: number;
  createdAt: number;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(env: Env, data: SessionData): Promise<string> {
  const id = randomId();
  await env.KV.put(`sess:${id}`, JSON.stringify(data), { expirationTtl: SESSION_TTL_SECONDS });
  return id;
}

export async function getSession(env: Env, id: string): Promise<SessionData | null> {
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  const raw = await env.KV.get(`sess:${id}`);
  return raw ? (JSON.parse(raw) as SessionData) : null;
}

export async function deleteSession(env: Env, id: string): Promise<void> {
  await env.KV.delete(`sess:${id}`);
}

export function setSessionCookie(c: Context, id: string): void {
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

/** CSRF state for the OAuth flow. */
export async function createOAuthState(env: Env): Promise<string> {
  const state = randomId();
  await env.KV.put(`oauthstate:${state}`, "1", { expirationTtl: 300 });
  return state;
}

export async function consumeOAuthState(env: Env, state: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(state)) return false;
  const found = await env.KV.get(`oauthstate:${state}`);
  if (!found) return false;
  await env.KV.delete(`oauthstate:${state}`);
  return true;
}
