import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import type { LogSettingsDto, WelcomeSettingsDto } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { upsertGuild } from "../src/db/queries.js";

const G = "920000000000000001";
const CHANNEL_IN_GUILD = "920000000000000101";
const CHANNEL_ELSEWHERE = "920000000000000102";

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

function call(path: string, sessionId: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        ...init,
        headers: {
          cookie: `session=${sessionId}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      },
      env,
      createExecutionContext(),
    ),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  await upsertGuild(env.DB, G, "Welcome Guild", null);

  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: G, name: "Welcome Guild", icon: null, owner: false, permissions: "32" }])
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/channels/${CHANNEL_IN_GUILD}`, method: "GET" })
    .reply(200, { id: CHANNEL_IN_GUILD, guild_id: G, type: 0 })
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/channels/${CHANNEL_ELSEWHERE}`, method: "GET" })
    .reply(200, { id: CHANNEL_ELSEWHERE, guild_id: "999999999999999999", type: 0 })
    .persist();
});

describe("welcome + log settings API", () => {
  it("serves defaults when nothing is stored", async () => {
    const sid = await makeSession("820000000000000001");
    const welcome = (await (await call(`/api/guilds/${G}/welcome`, sid)).json()) as WelcomeSettingsDto;
    expect(welcome.welcomeEnabled).toBe(false);
    expect(welcome.welcomeChannelId).toBeNull();
    expect(welcome.welcomeMessage).toContain("{mention}");

    const logs = (await (await call(`/api/guilds/${G}/log-settings`, sid)).json()) as LogSettingsDto;
    expect(logs.channelId).toBeNull();
    expect(logs.messageDelete).toBe(false);
  });

  it("stores welcome settings and rejects foreign channels", async () => {
    const sid = await makeSession("820000000000000002");
    const body = {
      welcomeEnabled: true,
      welcomeChannelId: CHANNEL_IN_GUILD,
      welcomeMessage: "Bienvenue {mention} !",
      leaveEnabled: false,
      leaveChannelId: null,
      leaveMessage: "{user} est parti.",
    };
    const ok = await call(`/api/guilds/${G}/welcome`, sid, { method: "PUT", body: JSON.stringify(body) });
    expect(ok.status).toBe(200);

    const read = (await (await call(`/api/guilds/${G}/welcome`, sid)).json()) as WelcomeSettingsDto;
    expect(read.welcomeEnabled).toBe(true);
    expect(read.welcomeChannelId).toBe(CHANNEL_IN_GUILD);
    expect(read.welcomeMessage).toBe("Bienvenue {mention} !");

    const bad = await call(`/api/guilds/${G}/welcome`, sid, {
      method: "PUT",
      body: JSON.stringify({ ...body, welcomeChannelId: CHANNEL_ELSEWHERE }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("channel_not_in_guild");
  });

  it("stores log settings and exposes everything on /internal config", async () => {
    const sid = await makeSession("820000000000000003");
    const put = await call(`/api/guilds/${G}/log-settings`, sid, {
      method: "PUT",
      body: JSON.stringify({
        channelId: CHANNEL_IN_GUILD,
        memberJoin: true,
        memberLeave: true,
        messageDelete: true,
        messageEdit: false,
        memberUpdate: false,
      }),
    });
    expect(put.status).toBe(200);

    const internal = await app.request(
      `/internal/guilds/${G}/config`,
      { headers: { authorization: "Bearer test-internal-token" } },
      env,
      createExecutionContext(),
    );
    expect(internal.status).toBe(200);
    const cfg = (await internal.json()) as { welcome: WelcomeSettingsDto; logs: LogSettingsDto };
    expect(cfg.logs.channelId).toBe(CHANNEL_IN_GUILD);
    expect(cfg.logs.memberJoin).toBe(true);
    expect(cfg.logs.messageEdit).toBe(false);
    // No welcome row in this test (D1 rolls back between tests): defaults.
    expect(cfg.welcome.welcomeEnabled).toBe(false);
  });

  it("rejects invalid bodies", async () => {
    const sid = await makeSession("820000000000000004");
    const res = await call(`/api/guilds/${G}/welcome`, sid, {
      method: "PUT",
      body: JSON.stringify({ welcomeEnabled: "yes" }),
    });
    expect(res.status).toBe(400);
  });
});
