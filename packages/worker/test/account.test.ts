import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import type { AccountResponse } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";

// /api/account only reads the KV session (no Discord, no fetchMock).

const USER = "820000000000000001";
const OTHER = "820000000000000002";

async function session(userId: string, username: string): Promise<string> {
  return createSession(env, {
    userId, username, globalName: null, avatar: "abc",
    accessToken: "secret-token", refreshToken: "unused", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
}

async function get(sid?: string): Promise<Response> {
  return app.request(
    "/api/account",
    { method: "GET", headers: sid ? { cookie: `session=${sid}` } : {} },
    env,
    createExecutionContext(),
  );
}

describe("M8 GET /api/account", () => {
  it("requires a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it("returns the profile and current-session metadata (ISO), no token", async () => {
    const sid = await session(USER, "alice");
    const res = await get(sid);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AccountResponse & Record<string, unknown>;
    expect(body.id).toBe(USER);
    expect(body.username).toBe("alice");
    expect(Object.keys(body).sort()).toEqual(["avatar", "globalName", "id", "session", "username"].sort());
    expect(Object.keys(body.session).sort()).toEqual(["createdAt", "expiresAt", "lastSeenAt"].sort());
    expect(new Date(body.session.createdAt).toISOString()).toBe(body.session.createdAt);
    expect(new Date(body.session.expiresAt).toISOString()).toBe(body.session.expiresAt);
    // Never leak the Discord access token or other internal session fields.
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(body).not.toHaveProperty("accessToken");
  });

  it("is scoped to the requesting session (no cross-user leak)", async () => {
    const a = await session(USER, "alice");
    const b = await session(OTHER, "bob");
    expect(((await (await get(a)).json()) as AccountResponse).id).toBe(USER);
    expect(((await (await get(b)).json()) as AccountResponse).id).toBe(OTHER);
  });
});
