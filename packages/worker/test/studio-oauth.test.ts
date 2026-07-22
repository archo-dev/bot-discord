import { describe, expect, it, vi } from "vitest";
import { createExecutionContext, env, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import {
  createStudioOAuthState,
  createStudioSession,
  loadStudioSession,
  revokeStudioSessions,
  validateStudioOAuthState,
  validateStudioStepUpState,
} from "../src/auth/studio-session.js";
import { validateOAuthState } from "../src/auth/session.js";
import { createOAuthStateCookieValue } from "../src/auth/oauth-state.js";

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
    const stepUpCookie = await createOAuthStateCookieValue(e.SESSION_SECRET, "studio-step-up", state, now);
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
    await expect(validateStudioStepUpState(withoutStateKv, state, stepUpCookie, now)).resolves.toEqual({ ok: true });
    await expect(validateStudioStepUpState(withoutStateKv, state, studioCookie, now)).resolves.toEqual({ ok: false, code: "state_mismatch" });
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

  it("uses an isolated signed cookie for Studio step-up and clears it on callback errors", async () => {
    const e = studioEnv();
    const sessionId = await createStudioSession(e, {
      userId: OWNER,
      username: "studio-owner",
      globalName: null,
      avatar: null,
      tokenExpiresAt: Date.now() + 3_600_000,
      createdAt: Date.now(),
    });
    const sessionCookie = `studio_session=${sessionId}`;
    const login = await request("/studio/auth/step-up", e, { headers: { cookie: sessionCookie } });
    expect(login.status).toBe(302);
    const authorize = new URL(login.headers.get("location")!);
    const state = authorize.searchParams.get("state")!;
    const setCookie = login.headers.get("set-cookie")!;
    expect(setCookie).toContain("studio_stepup_state=");
    expect(setCookie).toContain("Max-Age=300");
    expect(setCookie).toContain("Path=/studio/auth/step-up/callback");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toMatch(/;\s*Domain=/i);
    const stateCookie = setCookie.split(";", 1)[0]!;

    const callback = await request(`/studio/auth/step-up/callback?state=${state}`, e, {
      headers: { cookie: `${sessionCookie}; ${stateCookie}` },
    });
    expect(callback.status).toBe(400);
    expect(callback.headers.get("set-cookie")).toContain(
      "studio_stepup_state=; Max-Age=0; Path=/studio/auth/step-up/callback",
    );
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
