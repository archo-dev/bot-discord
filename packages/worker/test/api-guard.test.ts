import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { replacePanelAccess, upsertGuild } from "../src/db/queries.js";

const INSTALLED = "910000000000000001";
const NOT_INSTALLED = "910000000000000002";

async function makeSession(userId: string): Promise<string> {
  return createSession(env, {
    userId,
    username: `user${userId.slice(-2)}`,
    globalName: null,
    avatar: null,
    accessToken: `token-${userId}`,
    refreshToken: "r",
    tokenExpiresAt: Date.now() + 3600_000,
    createdAt: Date.now(),
  });
}

function get(path: string, sessionId?: string): Promise<Response> {
  return Promise.resolve(
    app.request(path, { headers: sessionId ? { cookie: `session=${sessionId}` } : {} }, env, createExecutionContext()),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  await upsertGuild(env.DB, INSTALLED, "Installed Guild", null);

  // Discord: managers see both guilds with MANAGE_GUILD; the "outsider" user
  // (id …42) has no permissions anywhere. The bot is only in INSTALLED.
  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply((req) => {
      const headers = req.headers as Record<string, string | string[]>;
      const auth = String(headers["authorization"] ?? headers["Authorization"] ?? "");
      const permissions = auth.includes("token-810000000000000042") ? "0" : "32";
      return {
        statusCode: 200,
        data: [
          { id: INSTALLED, name: "Installed Guild", icon: null, owner: false, permissions },
          { id: NOT_INSTALLED, name: "Other Guild", icon: null, owner: false, permissions },
        ],
      };
    })
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: /\/api\/v10\/guilds\/\d+\?with_counts=true/, method: "GET" })
    .reply(200, { id: INSTALLED, name: "Installed Guild", icon: null, approximate_member_count: 42 })
    .persist();
});

describe("panel API auth", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await get("/api/me")).status).toBe(401);
    expect((await get("/api/guilds")).status).toBe(401);
  });

  it("lists only manageable guilds where the bot is installed", async () => {
    const sid = await makeSession("810000000000000001");
    const res = await get("/api/guilds", sid);
    expect(res.status).toBe(200);
    const guilds = (await res.json()) as Array<{ id: string; access: string }>;
    expect(guilds.map((g) => g.id)).toEqual([INSTALLED]);
    expect(guilds[0]?.access).toBe("manage_guild");
  });

  it("grants guild access to MANAGE_GUILD members and returns the overview", async () => {
    const sid = await makeSession("810000000000000002");
    const res = await get(`/api/guilds/${INSTALLED}`, sid);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approximateMemberCount: number; gatewayConnected: boolean };
    expect(body.approximateMemberCount).toBe(42);
    expect(body.gatewayConnected).toBe(false);
  });

  it("404s guilds where the bot is not installed, even for managers", async () => {
    const sid = await makeSession("810000000000000003");
    const res = await get(`/api/guilds/${NOT_INSTALLED}`, sid);
    expect(res.status).toBe(404);
  });

  it("403s users without manage permission or grant, allows direct user grants", async () => {
    const outsider = "810000000000000042";
    const sid = await makeSession(outsider);

    expect((await get(`/api/guilds/${INSTALLED}`, sid)).status).toBe(403);

    await replacePanelAccess(env.DB, INSTALLED, [{ subjectType: "user", subjectId: outsider }], "someone");
    expect((await get(`/api/guilds/${INSTALLED}`, sid)).status).toBe(200);
  });
});
