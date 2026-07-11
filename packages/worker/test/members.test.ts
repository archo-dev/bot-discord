import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import type { ResolvedMember } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { upsertGuild } from "../src/db/queries.js";

const G = "930000000000000001";
const MEMBER = "930000000000000101"; // in guild, has nick + guild avatar
const LEFT = "930000000000000102"; // left guild → resolved via /users
const GHOST = "930000000000000103"; // unresolvable everywhere

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

function get(path: string, sessionId: string): Promise<Response> {
  return Promise.resolve(
    app.request(path, { headers: { cookie: `session=${sessionId}` } }, env, createExecutionContext()),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  await upsertGuild(env.DB, G, "Members Guild", null);

  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: G, name: "Members Guild", icon: null, owner: false, permissions: "32" }])
    .persist();

  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/guilds/${G}/members/${MEMBER}`, method: "GET" })
    .reply(200, {
      nick: "Sparky",
      avatar: "gavatarhash",
      user: { id: MEMBER, username: "sparky_real", global_name: "Sparky Global", avatar: "uavatar", bot: false },
    })
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/guilds/${G}/members/${LEFT}`, method: "GET" })
    .reply(404, { message: "Unknown Member", code: 10007 })
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/users/${LEFT}`, method: "GET" })
    .reply(200, { id: LEFT, username: "ghost_left", global_name: null, avatar: null, bot: false })
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/guilds/${G}/members/${GHOST}`, method: "GET" })
    .reply(404, { message: "Unknown Member", code: 10007 })
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/users/${GHOST}`, method: "GET" })
    .reply(404, { message: "Unknown User", code: 10013 })
    .persist();

  fetchMock
    .get("https://discord.com")
    .intercept({ path: /\/api\/v10\/guilds\/\d+\/members\/search/, method: "GET" })
    .reply(200, [
      { nick: "Sparky", avatar: null, user: { id: MEMBER, username: "sparky_real", global_name: "Sparky Global", avatar: null, bot: false } },
    ])
    .persist();
});

describe("member resolution API", () => {
  it("requires a session", async () => {
    expect((await app.request(`/api/guilds/${G}/members/resolve?ids=${MEMBER}`, {}, env, createExecutionContext())).status).toBe(401);
  });

  it("resolves a guild member with nick + guild avatar", async () => {
    const sid = await makeSession("830000000000000001");
    const res = await get(`/api/guilds/${G}/members/resolve?ids=${MEMBER}`, sid);
    expect(res.status).toBe(200);
    const list = (await res.json()) as ResolvedMember[];
    expect(list).toHaveLength(1);
    const m = list[0]!;
    expect(m.id).toBe(MEMBER);
    expect(m.displayName).toBe("Sparky"); // nick wins
    expect(m.username).toBe("sparky_real");
    expect(m.inGuild).toBe(true);
    expect(m.avatarUrl).toContain(`/guilds/${G}/users/${MEMBER}/avatars/gavatarhash.png`);
  });

  it("falls back to the global user (default avatar) for members who left, and drops the unresolvable", async () => {
    const sid = await makeSession("830000000000000002");
    const res = await get(`/api/guilds/${G}/members/resolve?ids=${LEFT},${GHOST}`, sid);
    expect(res.status).toBe(200);
    const list = (await res.json()) as ResolvedMember[];
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(LEFT);
    expect(list[0]?.inGuild).toBe(false);
    expect(list[0]?.displayName).toBe("ghost_left"); // no nick, no global_name
    expect(list[0]?.avatarUrl).toContain("/embed/avatars/");
  });

  it("ignores malformed ids and returns [] for an empty query", async () => {
    const sid = await makeSession("830000000000000003");
    const res = await get(`/api/guilds/${G}/members/resolve?ids=notanid,abc`, sid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("searches members by name", async () => {
    const sid = await makeSession("830000000000000004");
    const res = await get(`/api/guilds/${G}/members/search?q=spa`, sid);
    expect(res.status).toBe(200);
    const list = (await res.json()) as ResolvedMember[];
    expect(list).toHaveLength(1);
    expect(list[0]?.displayName).toBe("Sparky");
    expect(list[0]?.inGuild).toBe(true);
  });

  it("returns [] for an empty search query without hitting Discord", async () => {
    const sid = await makeSession("830000000000000005");
    const res = await get(`/api/guilds/${G}/members/search?q=`, sid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
