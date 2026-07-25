import { describe, expect, it, vi } from "vitest";
import { createExecutionContext, env, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import {
  createStudioOAuthState,
  createStudioSession,
  deleteStudioSession,
  loadStudioSession,
  revokeStudioSessions,
  validateStudioOAuthState,
  validateStudioStepUpBoundState,
} from "../src/auth/studio-session.js";
import { validateOAuthState } from "../src/auth/session.js";
import { createOAuthStateCookieValue, createStudioStepUpBinding } from "../src/auth/oauth-state.js";

const HOST = "studio.archodev.fr";
const OWNER = "700000000000000091";

function studioEnv(): Env {
  return {
    ...env,
    PANEL_ORIGIN: "https://archolabs.com",
    PLATFORM_STUDIO: "true",
    STUDIO_HOST: HOST,
    STUDIO_OWNER_IDS: OWNER,
  } as Env;
}

function request(path: string, e: Env, init: RequestInit = {}) {
  return app.request(`https://${HOST}${path}`, init, e, createExecutionContext());
}

function mockDiscordUser(userId: string) {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock.get("https://discord.com").intercept({ path: "/api/v10/oauth2/token", method: "POST" }).reply(200, {
    access_token: `studio-token-${userId}`,
    expires_in: 3600,
  });
  fetchMock.get("https://discord.com").intercept({ path: "/api/v10/users/@me", method: "GET" }).reply(200, {
    id: userId,
    username: "studio-owner",
    global_name: "Studio Owner",
    avatar: null,
  });
}

describe("Studio OAuth and session", () => {
  it("expires idle sessions and supports per-operator revocation", async () => {
    const e = studioEnv();
    const create = () => createStudioSession(e, {
      userId: OWNER,
      username: "studio-owner",
      globalName: null,
      avatar: null,
      tokenExpiresAt: Date.now() + 3_600_000,
      createdAt: Date.now(),
    });

    const idle = await create();
    const idleData = JSON.parse((await e.KV.get(`studio:sess:${idle}`))!) as Record<string, unknown>;
    idleData.lastSeenAt = Date.now() - 30 * 60_000 - 1;
    await e.KV.put(`studio:sess:${idle}`, JSON.stringify(idleData), { expirationTtl: 3600 });
    expect((await loadStudioSession(e, idle)).reason).toBe("expired");

    const revoked = await create();
    await revokeStudioSessions(e, OWNER);
    expect((await loadStudioSession(e, revoked)).reason).toBe("revoked");
  });

  it("uses the exact callback, creates an isolated cookie and requires Origin to log out", async () => {
    const e = studioEnv();
    mockDiscordUser(OWNER);

    const login = await request("/studio/auth/login", e);
    expect(login.status).toBe(302);
    const authorize = new URL(login.headers.get("location")!);
    expect(authorize.searchParams.get("redirect_uri")).toBe(`https://${HOST}/studio/auth/callback`);
    expect(authorize.searchParams.get("scope")).toBe("identify");
    const state = authorize.searchParams.get("state")!;
    const stateCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const oauthCookie = login.headers.get("set-cookie")!;
    expect(oauthCookie).toContain("Max-Age=300");
    expect(oauthCookie).toContain("Path=/studio/auth/callback");
    expect(oauthCookie).toContain("HttpOnly");
    expect(oauthCookie).toContain("Secure");
    expect(oauthCookie).toContain("SameSite=Lax");
    expect(oauthCookie).not.toMatch(/;\s*Domain=/i);

    const callback = await request(`/studio/auth/callback?code=valid&state=${state}`, e, {
      headers: { cookie: stateCookie },
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`https://${HOST}/`);
    expect(callback.headers.get("set-cookie")).toContain("studio_oauth_state=; Max-Age=0; Path=/studio/auth/callback");
    const setCookie = callback.headers.get("set-cookie") ?? "";
    const sessionId = /(?:^|,\s*)studio_session=([0-9a-f]{64})/.exec(setCookie)?.[1];
    expect(sessionId).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    const cookie = `studio_session=${sessionId}`;

    const session = await request("/studio-api/session", e, { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ operatorId: OWNER, isOwner: true });

    expect((await request("/studio/auth/logout", e, { method: "POST", headers: { cookie } })).status).toBe(403);
    const logout = await request("/studio/auth/logout", e, {
      method: "POST",
      headers: { cookie, origin: `https://${HOST}` },
    });
    expect(logout.status).toBe(200);
    expect((await request("/studio-api/session", e, { headers: { cookie } })).status).toBe(401);
  });

  it("consumes a denied request and offers a safe retry without reflecting Discord text", async () => {
    const e = studioEnv();
    const login = await request("/studio/auth/login", e);
    const authorize = new URL(login.headers.get("location")!);
    const state = authorize.searchParams.get("state")!;
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;

    const denied = await request(
      `/studio/auth/callback?error=access_denied&error_description=secret&state=${state}`,
      e,
      { headers: { cookie } },
    );
    expect(denied.status).toBe(400);
    const body = await denied.text();
    expect(body).toContain('href="/studio/auth/login"');
    expect(body).not.toContain("secret");
    expect(denied.headers.get("set-cookie")).toContain("studio_oauth_state=; Max-Age=0; Path=/studio/auth/callback");
  });

  it("keeps panel, Studio login and Studio step-up states cryptographically isolated without KV", async () => {
    const e = studioEnv();
    const now = 1_750_000_000_000;
    const state = createStudioOAuthState();
    const studioCookie = await createOAuthStateCookieValue(e.SESSION_SECRET, "studio", state, now);
    const panelCookie = await createOAuthStateCookieValue(e.SESSION_SECRET, "panel", state, now);
    const boundSid = "a".repeat(64);
    const stepUpBinding = await createStudioStepUpBinding(e.SESSION_SECRET, boundSid, state, now);
    const kvGet = vi.fn();
    const kvPut = vi.fn();
    const kvDelete = vi.fn();
    const withoutStateKv = {
      ...e,
      KV: { get: kvGet, put: kvPut, delete: kvDelete } as unknown as KVNamespace,
    };

    await expect(validateStudioOAuthState(withoutStateKv, state, studioCookie, now)).resolves.toEqual({ ok: true });
    await expect(validateStudioOAuthState(withoutStateKv, state, panelCookie, now)).resolves.toEqual({ ok: false, code: "state_mismatch" });
    await expect(validateOAuthState(withoutStateKv, state, studioCookie, now)).resolves.toEqual({ ok: false, code: "state_mismatch" });
    await expect(validateStudioStepUpBoundState(withoutStateKv, state, stepUpBinding, now)).resolves.toEqual({ ok: true, sid: boundSid });
    // A login (3-part) state can never validate as a (4-part) step-up binding.
    await expect(validateStudioStepUpBoundState(withoutStateKv, state, studioCookie, now)).resolves.toEqual({ ok: false, code: "state_mismatch" });
    expect(kvGet).not.toHaveBeenCalled();
    expect(kvPut).not.toHaveBeenCalled();
    expect(kvDelete).not.toHaveBeenCalled();
  });

  it("rejects a replay after a successful Studio callback without a second Discord exchange", async () => {
    const e = studioEnv();
    mockDiscordUser(OWNER);
    const login = await request("/studio/auth/login", e);
    const authorize = new URL(login.headers.get("location")!);
    const state = authorize.searchParams.get("state")!;
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const callbackUrl = `/studio/auth/callback?code=single-use&state=${state}`;
    const first = await request(callbackUrl, e, { headers: { cookie } });
    expect(first.status).toBe(302);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const replay = await request(callbackUrl, e);
    expect(replay.status).toBe(400);
    expect(warn).toHaveBeenCalledWith("studio oauth state validation failed: scope=login reason=missing_cookie");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(state);
    warn.mockRestore();
  });

  // --- Step-up (M14, option B): session bound into the signed state ----------
  const OTHER = "700000000000000077";
  const mkStudioSession = (e: Env, userId = OWNER) =>
    createStudioSession(e, {
      userId,
      username: "studio-owner",
      globalName: null,
      avatar: null,
      tokenExpiresAt: Date.now() + 3_600_000,
      createdAt: Date.now(),
    });
  /** GET /studio/auth/step-up with a valid session; returns the URL nonce + the
   *  bound step-up cookie (as it would be re-sent by the browser). */
  const startStepUp = async (e: Env, sessionId: string) => {
    const res = await request("/studio/auth/step-up", e, { headers: { cookie: `studio_session=${sessionId}` } });
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie")!;
    const nonce = new URL(res.headers.get("location")!).searchParams.get("state")!;
    const boundCookie = setCookie.split(";", 1)[0]!; // studio_stepup_state=<nonce.issuedAt.sid.sig>
    return { nonce, boundCookie, setCookie };
  };

  it("issues a Lax, session-bound step-up cookie and keeps studio_session Strict", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const { setCookie } = await startStepUp(e, sessionId);
    expect(setCookie).toContain("studio_stepup_state=");
    expect(setCookie).toContain("Max-Age=300");
    expect(setCookie).toContain("Path=/studio/auth/step-up/callback");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toMatch(/;\s*Domain=/i);
    // The step-up request must never re-issue or weaken the Strict session cookie.
    expect(setCookie).not.toContain("studio_session=");
  });

  it("completes step-up WITHOUT the studio_session cookie at the callback (session recovered from the signed state)", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const { nonce, boundCookie } = await startStepUp(e, sessionId);
    mockDiscordUser(OWNER);
    // Callback carries ONLY the Lax bound cookie — no studio_session (Strict, withheld cross-site).
    const cb = await request(`/studio/auth/step-up/callback?code=valid&state=${nonce}`, e, {
      headers: { cookie: boundCookie },
    });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe(`https://${HOST}/`);
    expect(cb.headers.get("set-cookie")).toContain("studio_stepup_state=; Max-Age=0; Path=/studio/auth/step-up/callback");
    const stored = JSON.parse((await e.KV.get(`studio:sess:${sessionId}`))!) as { stepUpAt?: number };
    expect(typeof stored.stepUpAt).toBe("number");
    expect(stored.stepUpAt!).toBeGreaterThan(0);
  });

  it("fails closed when the bound session no longer exists", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const { nonce, boundCookie } = await startStepUp(e, sessionId);
    await deleteStudioSession(e, sessionId); // session gone, but signed state still references it
    // No Discord mock: the handler fails closed at the session lookup, before any token exchange.
    const cb = await request(`/studio/auth/step-up/callback?code=valid&state=${nonce}`, e, {
      headers: { cookie: boundCookie },
    });
    expect(cb.status).toBe(401);
    const stored = await e.KV.get(`studio:sess:${sessionId}`);
    expect(stored).toBeNull();
  });

  it("fails closed when the bound session is expired", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const { nonce, boundCookie } = await startStepUp(e, sessionId);
    const data = JSON.parse((await e.KV.get(`studio:sess:${sessionId}`))!) as Record<string, unknown>;
    data.absoluteExpiresAt = Date.now() - 1;
    await e.KV.put(`studio:sess:${sessionId}`, JSON.stringify(data), { expirationTtl: 3600 });
    // No Discord mock: the handler fails closed at the session lookup, before any token exchange.
    const cb = await request(`/studio/auth/step-up/callback?code=valid&state=${nonce}`, e, {
      headers: { cookie: boundCookie },
    });
    expect(cb.status).toBe(401);
  });

  it("fails closed on a globalVersion mismatch (kill-switch)", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const { nonce, boundCookie } = await startStepUp(e, sessionId);
    const data = JSON.parse((await e.KV.get(`studio:sess:${sessionId}`))!) as Record<string, unknown>;
    data.globalVersion = "999";
    await e.KV.put(`studio:sess:${sessionId}`, JSON.stringify(data), { expirationTtl: 3600 });
    // No Discord mock: the handler fails closed at the session lookup, before any token exchange.
    const cb = await request(`/studio/auth/step-up/callback?code=valid&state=${nonce}`, e, {
      headers: { cookie: boundCookie },
    });
    expect(cb.status).toBe(401);
  });

  it("fails closed on a userGeneration mismatch (per-operator revocation)", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const { nonce, boundCookie } = await startStepUp(e, sessionId);
    await revokeStudioSessions(e, OWNER); // bumps the operator generation
    // No Discord mock: the handler fails closed at the session lookup, before any token exchange.
    const cb = await request(`/studio/auth/step-up/callback?code=valid&state=${nonce}`, e, {
      headers: { cookie: boundCookie },
    });
    expect(cb.status).toBe(401);
  });

  it("rejects a step-up whose re-consented Discord user differs from the session user", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e, OWNER);
    const { nonce, boundCookie } = await startStepUp(e, sessionId);
    mockDiscordUser(OTHER); // Discord returns a DIFFERENT user than the session's OWNER
    const cb = await request(`/studio/auth/step-up/callback?code=valid&state=${nonce}`, e, {
      headers: { cookie: boundCookie },
    });
    expect(cb.status).toBe(403);
    const stored = JSON.parse((await e.KV.get(`studio:sess:${sessionId}`))!) as { stepUpAt?: number };
    expect(stored.stepUpAt).toBeUndefined(); // never stamped
  });

  it("rejects a forged step-up state (tampered signature)", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const { nonce, boundCookie } = await startStepUp(e, sessionId);
    const last = boundCookie.slice(-1) === "0" ? "1" : "0";
    const forged = `${boundCookie.slice(0, -1)}${last}`; // flip the final signature hex char
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cb = await request(`/studio/auth/step-up/callback?code=valid&state=${nonce}`, e, {
      headers: { cookie: forged },
    });
    expect(cb.status).toBe(400);
    expect(warn).toHaveBeenCalledWith("studio oauth state validation failed: scope=step-up reason=state_mismatch");
    warn.mockRestore();
  });

  it("rejects a login state presented as a step-up state", async () => {
    const e = studioEnv();
    const now = Date.now();
    const state = createStudioOAuthState();
    const loginCookieValue = await createOAuthStateCookieValue(e.SESSION_SECRET, "studio", state, now);
    const cb = await request(`/studio/auth/step-up/callback?code=valid&state=${state}`, e, {
      headers: { cookie: `studio_stepup_state=${loginCookieValue}` },
    });
    expect(cb.status).toBe(400); // 3-part login value can never satisfy the 4-part bound format
  });

  it("rejects an expired step-up state and accepts a fresh one (unit)", async () => {
    const e = studioEnv();
    const now = 1_750_000_000_000;
    const nonce = createStudioOAuthState();
    const sid = "b".repeat(64);
    const bound = await createStudioStepUpBinding(e.SESSION_SECRET, sid, nonce, now);
    await expect(validateStudioStepUpBoundState(e, nonce, bound, now + 1)).resolves.toEqual({ ok: true, sid });
    await expect(validateStudioStepUpBoundState(e, nonce, bound, now + 300_001)).resolves.toEqual({ ok: false, code: "state_expired" });
  });

  it("rejects a step-up callback without an OAuth code", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const { nonce, boundCookie } = await startStepUp(e, sessionId);
    const cb = await request(`/studio/auth/step-up/callback?state=${nonce}`, e, { headers: { cookie: boundCookie } });
    expect(cb.status).toBe(400);
  });

  it("rejects a replayed step-up callback once the cookie has been cleared", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const { nonce, boundCookie } = await startStepUp(e, sessionId);
    mockDiscordUser(OWNER);
    const first = await request(`/studio/auth/step-up/callback?code=valid&state=${nonce}`, e, {
      headers: { cookie: boundCookie },
    });
    expect(first.status).toBe(302);
    // Replay: the browser no longer holds the cleared Lax cookie → missing_cookie.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const replay = await request(`/studio/auth/step-up/callback?code=valid&state=${nonce}`, e, {});
    expect(replay.status).toBe(400);
    expect(warn).toHaveBeenCalledWith("studio oauth state validation failed: scope=step-up reason=missing_cookie");
    warn.mockRestore();
  });

  it("with two step-up tabs, only the surviving cookie's nonce validates (last cookie wins)", async () => {
    const e = studioEnv();
    const sessionId = await mkStudioSession(e);
    const tabA = await startStepUp(e, sessionId);
    const tabB = await startStepUp(e, sessionId);
    // Browser keeps a single studio_stepup_state (same name+Path) → tabB's cookie.
    await expect(validateStudioStepUpBoundState(e, tabB.nonce, tabB.boundCookie.split("=").slice(1).join("="))).resolves.toMatchObject({ ok: true, sid: sessionId });
    await expect(validateStudioStepUpBoundState(e, tabA.nonce, tabB.boundCookie.split("=").slice(1).join("="))).resolves.toEqual({ ok: false, code: "state_mismatch" });
  });

  it("never creates a session for a non-operator", async () => {
    const e = studioEnv();
    const outsider = "700000000000000099";
    mockDiscordUser(outsider);
    const login = await request("/studio/auth/login", e);
    const authorize = new URL(login.headers.get("location")!);
    const state = authorize.searchParams.get("state")!;
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;

    const callback = await request(`/studio/auth/callback?code=valid&state=${state}`, e, { headers: { cookie } });
    expect(callback.status).toBe(403);
    expect(callback.headers.get("set-cookie") ?? "").not.toMatch(/(?:^|,\s*)studio_session=/);
  });
});
