import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import type { AutomodSettingsDto } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { activeWarningCount, setGuildModuleEnabled, upsertAutomodSettings, upsertGuild } from "../src/db/queries.js";

const G = "930000000000000001";
const TARGET = "930000000000000777";

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

function panel(path: string, sessionId: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        ...init,
        headers: { cookie: `session=${sessionId}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      },
      env,
      createExecutionContext(),
    ),
  );
}

function internal(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        method: "POST",
        headers: { authorization: "Bearer test-internal-token", "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
      createExecutionContext(),
    ),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  await upsertGuild(env.DB, G, "Automod Guild", null);

  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: G, name: "Automod Guild", icon: null, owner: false, permissions: "32" }])
    .persist();
  // Timeout PATCHes (direct sanction + warn-threshold auto-timeout).
  fetchMock
    .get("https://discord.com")
    .intercept({ path: new RegExp(`/api/v10/guilds/${G}/members/\\d+`), method: "PATCH" })
    .reply(200, {})
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/guilds/${G}`, method: "GET" })
    .reply(200, { owner_id: "930000000000000099" })
    .persist();
});

describe("automod settings API", () => {
  it("serves defaults and stores a full config", async () => {
    const sid = await makeSession("830000000000000001");
    const defaults = (await (await panel(`/api/guilds/${G}/automod`, sid)).json()) as AutomodSettingsDto;
    expect(defaults.antiSpamEnabled).toBe(false);
    expect(defaults.action).toBe("delete");
    expect(defaults.linkWhitelist).toEqual([]);

    const body: AutomodSettingsDto = {
      antiSpamEnabled: true,
      antiSpamMaxMessages: 6,
      antiSpamWindowSeconds: 10,
      antiInviteEnabled: true,
      antiLinkEnabled: true,
      linkWhitelist: ["youtube.com"],
      bannedWords: ["vilain mot"],
      exemptRoleIds: ["930000000000000100"],
      exemptChannelIds: [],
      action: "warn",
      timeoutMinutes: 15,
    };
    const put = await panel(`/api/guilds/${G}/automod`, sid, { method: "PUT", body: JSON.stringify(body) });
    expect(put.status).toBe(200);
    const read = (await (await panel(`/api/guilds/${G}/automod`, sid)).json()) as AutomodSettingsDto;
    expect(read.antiSpamMaxMessages).toBe(6);
    expect(read.linkWhitelist).toEqual(["youtube.com"]);
    expect(read.bannedWords).toEqual(["vilain mot"]);
    expect(read.action).toBe("warn");

    const bad = await panel(`/api/guilds/${G}/automod`, sid, {
      method: "PUT",
      body: JSON.stringify({ ...body, antiSpamMaxMessages: 999 }),
    });
    expect(bad.status).toBe(400);
  });

  it("exposes automod on /internal config", async () => {
    await upsertAutomodSettings(env.DB, G, {
      antiSpamEnabled: true,
      antiSpamMaxMessages: 5,
      antiSpamWindowSeconds: 5,
      antiInviteEnabled: false,
      antiLinkEnabled: false,
      linkWhitelist: [],
      bannedWords: [],
      exemptRoleIds: [],
      exemptChannelIds: [],
      action: "timeout",
      timeoutMinutes: 20,
    });
    const res = await app.request(
      `/internal/guilds/${G}/config`,
      { headers: { authorization: "Bearer test-internal-token" } },
      env,
      createExecutionContext(),
    );
    const cfg = (await res.json()) as { automod: AutomodSettingsDto };
    expect(cfg.automod.antiSpamEnabled).toBe(true);
    expect(cfg.automod.action).toBe("timeout");
    expect(cfg.automod.timeoutMinutes).toBe(20);
  });
});

describe("internal automod sanctions", () => {
  beforeAll(async () => {
    await setGuildModuleEnabled(env.DB, G, "automod", true);
  });

  it("warn inserts a warning and trips the threshold into an auto-timeout", async () => {
    // Default threshold is 3: two prior automod warns + this one = auto-timeout.
    await internal(`/internal/guilds/${G}/automod-sanctions`, { userId: TARGET, rule: "invite", action: "warn" });
    await internal(`/internal/guilds/${G}/automod-sanctions`, { userId: TARGET, rule: "link", action: "warn" });
    const res = await internal(`/internal/guilds/${G}/automod-sanctions`, { userId: TARGET, rule: "spam", action: "warn" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { applied: string; warnCount: number; autoTimeout: boolean };
    expect(body.applied).toBe("warn");
    expect(body.warnCount).toBe(3);
    expect(body.autoTimeout).toBe(true);
    expect(await activeWarningCount(env.DB, G, TARGET)).toBe(3);
  });

  it("timeout applies the automod duration directly", async () => {
    const res = await internal(`/internal/guilds/${G}/automod-sanctions`, { userId: TARGET, rule: "word", action: "timeout" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { applied: string }).applied).toBe("timeout");
  });

  it("rejects bad payloads and missing auth", async () => {
    const bad = await internal(`/internal/guilds/${G}/automod-sanctions`, { userId: TARGET, rule: "nope", action: "warn" });
    expect(bad.status).toBe(400);

    const unauth = await app.request(
      `/internal/guilds/${G}/automod-sanctions`,
      { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
      env,
      createExecutionContext(),
    );
    expect(unauth.status).toBe(401);
  });
});
