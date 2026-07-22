import { describe, expect, it, vi } from "vitest";
import { createExecutionContext, env, fetchMock } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.js";
import app from "../src/index.js";
import { consumeOAuthState, createOAuthState, createSession, loadSession, revokeUserSessions, setSessionCookie } from "../src/auth/session.js";

const LOCAL = { ...env, PANEL_ORIGIN: "http://localhost:5173", SECURITY_ORIGIN_MODE: "enforce" as const };
const PROD = { ...env, PANEL_ORIGIN: "https://botdiscord.archodev.workers.dev", SECURITY_ORIGIN_MODE: "enforce" as const };

describe("M02 browser security", () => {
  it("enforces exact origins in localhost and production", async () => {
    const localOk = await app.request("/auth/logout", { method: "POST", headers: { origin: LOCAL.PANEL_ORIGIN } }, LOCAL, createExecutionContext());
    expect(localOk.status).toBe(200);
    expect((await app.request("/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } }, PROD, createExecutionContext())).status).toBe(403);
    expect((await app.request("/auth/logout", { method: "POST" }, PROD, createExecutionContext())).status).toBe(403);
    expect((await app.request("/auth/logout", { method: "POST", headers: { origin: `${PROD.PANEL_ORIGIN}.evil.example` } }, PROD, createExecutionContext())).status).toBe(403);
  });

  it("sets environment-appropriate OAuth cookies and security headers", async () => {
    const local = await app.request("/auth/login", {}, LOCAL, createExecutionContext());
    expect(local.headers.get("set-cookie")).not.toContain("Secure");
    expect(local.headers.get("strict-transport-security")).toBeNull();
    const prod = await app.request(`${PROD.PANEL_ORIGIN}/auth/login`, {}, PROD, createExecutionContext());
    expect(prod.headers.get("set-cookie")).toContain("Secure");
    expect(prod.headers.get("strict-transport-security")).toBe("max-age=15552000");
    expect(prod.headers.get("content-security-policy-report-only")).toContain("script-src 'self'");
    expect(prod.headers.get("x-frame-options")).toBe("DENY");

    const cookieApp = new Hono<{ Bindings: Env }>();
    cookieApp.get("/", (c) => { setSessionCookie(c, "a".repeat(64)); return c.text("ok"); });
    expect((await cookieApp.request("/", {}, LOCAL)).headers.get("set-cookie")).not.toContain("Secure");
    const sessionCookie = (await cookieApp.request(PROD.PANEL_ORIGIN, {}, PROD)).headers.get("set-cookie")!;
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Lax");
  });

  it("completes the exact OAuth callback, creates a session and logs it out", async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get("https://discord.com").intercept({ path: "/api/v10/oauth2/token", method: "POST" }).reply(200, {
      access_token: "oauth-access-token",
      refresh_token: "oauth-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "identify guilds",
    });
    fetchMock.get("https://discord.com").intercept({ path: "/api/v10/users/@me", method: "GET" }).reply(200, {
      id: "880000000000000010",
      username: "oauth-user",
      global_name: "OAuth User",
      avatar: null,
    });

    const login = await app.request("/auth/login", {}, LOCAL, createExecutionContext());
    expect(login.status).toBe(302);
    const authorize = new URL(login.headers.get("location")!);
    expect(authorize.origin + authorize.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${LOCAL.PANEL_ORIGIN}/auth/callback`);
    expect(authorize.searchParams.get("scope")).toBe("identify guilds");
    const state = authorize.searchParams.get("state")!;
    const stateCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;

    const callback = await app.request(
      `/auth/callback?code=valid&state=${state}`,
      { headers: { cookie: stateCookie } },
      LOCAL,
      createExecutionContext(),
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${LOCAL.PANEL_ORIGIN}/`);
    const sessionId = /(?:^|,\s*)session=([0-9a-f]{64})/.exec(callback.headers.get("set-cookie") ?? "")?.[1];
    expect(sessionId).toBeTruthy();

    const sessionCookie = `session=${sessionId}`;
    const me = await app.request("/api/me", { headers: { cookie: sessionCookie } }, LOCAL, createExecutionContext());
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: "880000000000000010", username: "oauth-user" });

    const logout = await app.request(
      "/auth/logout",
      { method: "POST", headers: { cookie: sessionCookie, origin: LOCAL.PANEL_ORIGIN } },
      LOCAL,
      createExecutionContext(),
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("session=");
    expect((await app.request("/api/me", { headers: { cookie: sessionCookie } }, LOCAL, createExecutionContext())).status).toBe(401);
  });

  it("consumes a denied OAuth request and returns a recoverable error page", async () => {
    const login = await app.request("/auth/login", {}, LOCAL, createExecutionContext());
    const authorize = new URL(login.headers.get("location")!);
    const state = authorize.searchParams.get("state")!;
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;

    const denied = await app.request(
      `/auth/callback?error=access_denied&error_description=secret&state=${state}`,
      { headers: { cookie } },
      LOCAL,
      createExecutionContext(),
    );
    expect(denied.status).toBe(400);
    expect(denied.headers.get("content-type")).toContain("text/html");
    const body = await denied.text();
    expect(body).toContain('href="/auth/login"');
    expect(body).not.toContain("secret");
    expect(await env.KV.get(`oauthstate:${state}`)).toBeNull();
  });

  it("binds OAuth state to the browser and consumes it once", async () => {
    const state = await createOAuthState(env);
    expect(await consumeOAuthState(env, state, "wrong")).toBe(false);
    expect(await consumeOAuthState(env, state, state)).toBe(true);
    expect(await consumeOAuthState(env, state, state)).toBe(false);
  });

  it("expires, revokes and globally invalidates minimized sessions", async () => {
    const sid = await createSession(env, {
      userId: "880000000000000001", username: "u", globalName: null, avatar: null,
      accessToken: "needed-for-guild-check", refreshToken: "must-not-persist",
      tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
    });
    const raw = await env.KV.get(`sess:${sid}`);
    expect(raw).not.toContain("must-not-persist");
    expect((await loadSession(env, sid)).session).not.toBeNull();
    await revokeUserSessions(env, "880000000000000001");
    expect((await loadSession(env, sid)).reason).toBe("revoked");

    const expired = await createSession(env, {
      userId: "880000000000000002", username: "u", globalName: null, avatar: null,
      accessToken: "short", tokenExpiresAt: Date.now() - 1, createdAt: Date.now() - 10_000,
    });
    expect((await loadSession(env, expired)).reason).toBe("expired");

    const idle = await createSession(env, {
      userId: "880000000000000003", username: "u", globalName: null, avatar: null,
      accessToken: "idle", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
    });
    const idleData = JSON.parse((await env.KV.get(`sess:${idle}`))!) as Record<string, unknown>;
    idleData["lastSeenAt"] = Date.now() - 2 * 3_600_000 - 1;
    await env.KV.put(`sess:${idle}`, JSON.stringify(idleData), { expirationTtl: 3600 });
    expect((await loadSession(env, idle)).reason).toBe("expired");

    const global = await createSession(env, {
      userId: "880000000000000004", username: "u", globalName: null, avatar: null,
      accessToken: "global", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
    });
    expect((await loadSession({ ...env, SESSION_GLOBAL_VERSION: "2" }, global)).reason).toBe("revoked");
  });

  it("redacts Discord OAuth error bodies", async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get("https://discord.com").intercept({ path: "/api/v10/oauth2/token", method: "POST" })
      .reply(400, "sensitive-upstream-token");
    const login = await app.request("/auth/login", {}, LOCAL, createExecutionContext());
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request(`/auth/callback?code=bad&state=${state}`, { headers: { cookie } }, LOCAL, createExecutionContext());
    expect(response.status).toBe(502);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("sensitive-upstream-token");
    spy.mockRestore();
  });

  it("applies route-family body limits", async () => {
    const tooLarge = "x".repeat(65 * 1024);
    const response = await app.request("/api/guilds/970000000000000001/config", {
      method: "PATCH", headers: { origin: LOCAL.PANEL_ORIGIN, "content-type": "application/json" }, body: tooLarge,
    }, LOCAL, createExecutionContext());
    expect(response.status).toBe(413);
  });
});
