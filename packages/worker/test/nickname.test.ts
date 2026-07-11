import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { getGuild, upsertGuild } from "../src/db/queries.js";

// M16 — bot nickname: the value is persisted first, then applied via REST.
// A missing CHANGE_NICKNAME permission (Discord 403) becomes 409 "not applied"
// while the chosen value stays stored.

const GUILD = "930000000000000001";
const ADMIN = "830000000000000010";
const MANAGE_GUILD = "32"; // 0x20

async function makeSession(userId: string): Promise<string> {
  return createSession(env, {
    userId,
    username: "admin",
    globalName: null,
    avatar: null,
    accessToken: `token-${userId}`,
    refreshToken: "r",
    tokenExpiresAt: Date.now() + 3600_000,
    createdAt: Date.now(),
  });
}

function patchNickname(sessionId: string, nickname: string | null): Promise<Response> {
  return Promise.resolve(
    app.request(
      `/api/guilds/${GUILD}/nickname`,
      {
        method: "PATCH",
        headers: { cookie: `session=${sessionId}`, "content-type": "application/json" },
        body: JSON.stringify({ nickname }),
      },
      env,
      createExecutionContext(),
    ),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  await upsertGuild(env.DB, GUILD, "Nick Guild", null);

  // The admin has MANAGE_GUILD via Discord OAuth (no panel_access needed).
  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: GUILD, name: "Nick Guild", icon: null, owner: false, permissions: MANAGE_GUILD }])
    .persist();
});

describe("bot nickname (M16)", () => {
  it("stores and applies the nickname when Discord accepts it", async () => {
    let sentNick: unknown = "unset";
    fetchMock
      .get("https://discord.com")
      .intercept({
        path: `/api/v10/guilds/${GUILD}/members/@me`,
        method: "PATCH",
        body: (b) => {
          sentNick = (JSON.parse(String(b)) as { nick: unknown }).nick;
          return true;
        },
      })
      .reply(200, {});

    const sid = await makeSession(ADMIN);
    const res = await patchNickname(sid, "Concierge");
    expect(res.status).toBe(200);
    expect(sentNick).toBe("Concierge");
    expect((await getGuild(env.DB, GUILD))?.custom_nickname).toBe("Concierge");
  });

  it("returns 409 missing_permission but keeps the value stored when Discord 403s", async () => {
    fetchMock
      .get("https://discord.com")
      .intercept({ path: `/api/v10/guilds/${GUILD}/members/@me`, method: "PATCH" })
      .reply(403, { code: 50013, message: "Missing Permissions" });

    const sid = await makeSession(ADMIN);
    const res = await patchNickname(sid, "Majordome");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("missing_permission");
    // Stored despite the failure to apply.
    expect((await getGuild(env.DB, GUILD))?.custom_nickname).toBe("Majordome");
  });

  it("resets to the default username when given null", async () => {
    let sentNick: unknown = "unset";
    fetchMock
      .get("https://discord.com")
      .intercept({
        path: `/api/v10/guilds/${GUILD}/members/@me`,
        method: "PATCH",
        body: (b) => {
          sentNick = (JSON.parse(String(b)) as { nick: unknown }).nick;
          return true;
        },
      })
      .reply(200, {});

    const sid = await makeSession(ADMIN);
    const res = await patchNickname(sid, null);
    expect(res.status).toBe(200);
    expect(sentNick).toBeNull();
    expect((await getGuild(env.DB, GUILD))?.custom_nickname).toBeNull();
  });
});
