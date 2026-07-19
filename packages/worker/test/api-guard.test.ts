import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { replacePanelAccess, upsertGuild } from "../src/db/queries.js";

const INSTALLED = "910000000000000001";
const NOT_INSTALLED = "910000000000000002";
const transientDiscordUsers = new Set<string>();
const serverErrorDiscordUsers = new Set<string>();
const discordGuildCalls = new Map<string, number>();

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

function post(path: string, sessionId: string): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      { method: "POST", headers: { cookie: `session=${sessionId}`, origin: env.PANEL_ORIGIN } },
      env,
      createExecutionContext(),
    ),
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
      const uid = /token-(\d+)/.exec(auth)?.[1];
      if (uid) discordGuildCalls.set(uid, (discordGuildCalls.get(uid) ?? 0) + 1);
      if ([...serverErrorDiscordUsers].some((userId) => auth.includes(`token-${userId}`))) {
        return { statusCode: 503, data: [] };
      }
      if ([...transientDiscordUsers].some((userId) => auth.includes(`token-${userId}`))) {
        return { statusCode: 429, data: [], responseOptions: { headers: { "retry-after": "3" } } };
      }
      const permissions = auth.includes("token-810000000000000042") || auth.includes("token-810000000000000077") ? "0" : "32";
      const owner = auth.includes("token-810000000000000077");
      return {
        statusCode: 200,
        data: [
          { id: INSTALLED, name: "Installed Guild", icon: null, owner, permissions },
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

  it("reports gatewayConnected while the heartbeat key is fresh", async () => {
    await env.KV.put("gateway:status", JSON.stringify({ at: Date.now(), guildCount: 1, wsPing: 30 }), {
      expirationTtl: 180,
    });
    const sid = await makeSession("810000000000000002");
    const res = await get(`/api/guilds/${INSTALLED}`, sid);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gatewayConnected: boolean };
    expect(body.gatewayConnected).toBe(true);
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

    await replacePanelAccess(env.DB, INSTALLED, [{ subjectType: "user", subjectId: outsider, level: "admin" }], "someone");
    expect((await get(`/api/guilds/${INSTALLED}`, sid)).status).toBe(200);
  });

  it("recognizes the Discord owner even when OAuth omits MANAGE_GUILD", async () => {
    const owner = "810000000000000077";
    const sid = await makeSession(owner);
    expect((await get(`/api/guilds/${INSTALLED}`, sid)).status).toBe(200);
    const guilds = await get("/api/guilds", sid);
    expect((await guilds.json() as Array<{ id: string }>).map((g) => g.id)).toContain(INSTALLED);
  });

  it("keeps music-state reads available from a recent verified guild list during Discord 429", async () => {
    const userId = "810000000000000088";
    const sid = await makeSession(userId);
    expect((await get(`/api/guilds/${INSTALLED}/music-state`, sid)).status).toBe(200);
    await env.KV.delete(`guilds:${userId}`);
    transientDiscordUsers.add(userId);
    try {
      expect((await get(`/api/guilds/${INSTALLED}/music-state`, sid)).status).toBe(200);
    } finally {
      transientDiscordUsers.delete(userId);
    }
  });

  it("returns 429 with Retry-After instead of 500 when Discord rate-limits and no recent list exists", async () => {
    const userId = "810000000000000089";
    const sid = await makeSession(userId);
    transientDiscordUsers.add(userId);
    try {
      const res = await get(`/api/guilds/${INSTALLED}/music-state`, sid);
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("3");
      expect((await res.json() as { error: string }).error).toBe("rate_limited");
    } finally {
      transientDiscordUsers.delete(userId);
    }
  });

  it("keeps any read-only guild page available from the recent list during a Discord 429", async () => {
    const userId = "810000000000000090";
    const sid = await makeSession(userId);
    // Manager (permissions "32") — a first read verifies and caches the list.
    expect((await get(`/api/guilds/${INSTALLED}`, sid)).status).toBe(200);
    await env.KV.delete(`guilds:${userId}`);
    transientDiscordUsers.add(userId);
    try {
      expect((await get(`/api/guilds/${INSTALLED}`, sid)).status).toBe(200);
    } finally {
      transientDiscordUsers.delete(userId);
    }
  });

  it("fails writes closed during a Discord 429 even with a recent list", async () => {
    const userId = "810000000000000091";
    const sid = await makeSession(userId);
    expect((await get(`/api/guilds/${INSTALLED}`, sid)).status).toBe(200); // caches recent
    await env.KV.delete(`guilds:${userId}`);
    transientDiscordUsers.add(userId);
    try {
      // A write must re-verify against Discord; the recent list is not accepted.
      const res = await post(`/api/guilds/${INSTALLED}/music-state`, sid);
      expect(res.status).toBe(429);
    } finally {
      transientDiscordUsers.delete(userId);
    }
  });

  it("maps a Discord 5xx to 503 when no recent list can cover the read", async () => {
    const userId = "810000000000000092";
    const sid = await makeSession(userId);
    serverErrorDiscordUsers.add(userId);
    try {
      const res = await get(`/api/guilds/${INSTALLED}/music-state`, sid);
      expect(res.status).toBe(503);
      expect((await res.json() as { error: string }).error).toBe("discord_unavailable");
    } finally {
      serverErrorDiscordUsers.delete(userId);
    }
  });

  it("stops hitting Discord for the Retry-After window and coalesces concurrent polls", async () => {
    const userId = "810000000000000093";
    const sid = await makeSession(userId);
    expect((await get(`/api/guilds/${INSTALLED}/music-state`, sid)).status).toBe(200); // 1 Discord call
    await env.KV.delete(`guilds:${userId}`);
    transientDiscordUsers.add(userId);
    try {
      // A burst of concurrent polls shares one in-flight Discord fetch (the 429),
      // which then arms the backoff so later polls serve `recent` untouched.
      const burst = await Promise.all(
        Array.from({ length: 5 }, () => get(`/api/guilds/${INSTALLED}/music-state`, sid)),
      );
      expect(burst.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect((await get(`/api/guilds/${INSTALLED}/music-state`, sid)).status).toBe(200);
      // 1 successful verify + at most 1 rate-limited fetch — never one per poll.
      expect(discordGuildCalls.get(userId)).toBeLessThanOrEqual(2);
    } finally {
      transientDiscordUsers.delete(userId);
    }
  });
});
