import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import { levelFromXp, totalXpForLevel, xpForNextLevel } from "@bot/shared";
import type { LeaderboardEntry, XpSettingsDto } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { getXpMember, upsertGuild, upsertXpSettings } from "../src/db/queries.js";

const G = "940000000000000001";
const USER = "940000000000000777";
const VUSER = "940000000000000778";
const CHANNEL = "940000000000000101";
const REWARD_ROLE = "940000000000000200";

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

function grant(userId = USER): Promise<Response> {
  return Promise.resolve(
    app.request(
      `/internal/guilds/${G}/xp`,
      {
        method: "POST",
        headers: { authorization: "Bearer test-internal-token", "content-type": "application/json" },
        body: JSON.stringify({ userId, username: "testeur", channelId: CHANNEL }),
      },
      env,
      createExecutionContext(),
    ),
  );
}

const XP100 = {
  enabled: true,
  xpMin: 100,
  xpMax: 100,
  cooldownSeconds: 60,
  announceLevelUp: true,
  announceChannelId: null,
  rewards: [{ level: 1, roleId: REWARD_ROLE }],
  voiceEnabled: false,
  voiceXpPerMin: 10,
};

function grantVoice(entries: Array<{ userId: string; username?: string; channelId: string }>): Promise<Response> {
  return Promise.resolve(
    app.request(
      `/internal/guilds/${G}/voice-xp`,
      {
        method: "POST",
        headers: { authorization: "Bearer test-internal-token", "content-type": "application/json" },
        body: JSON.stringify({ entries }),
      },
      env,
      createExecutionContext(),
    ),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  await upsertGuild(env.DB, G, "XP Guild", null);

  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: G, name: "XP Guild", icon: null, owner: false, permissions: "32" }])
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/channels/${CHANNEL}`, method: "GET" })
    .reply(200, { id: CHANNEL, guild_id: G, type: 0 })
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/channels/${CHANNEL}/messages`, method: "POST" })
    .reply(200, { id: "1" })
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: new RegExp(`/api/v10/guilds/${G}/members/\\d+/roles/\\d+`), method: "PUT" })
    .reply(204, "")
    .persist();
});

describe("xp curve", () => {
  it("follows 5n²+50n+100", () => {
    expect(xpForNextLevel(0)).toBe(100);
    expect(xpForNextLevel(1)).toBe(155);
    expect(totalXpForLevel(0)).toBe(0);
    expect(totalXpForLevel(2)).toBe(255);
    expect(levelFromXp(0)).toBe(0);
    expect(levelFromXp(99)).toBe(0);
    expect(levelFromXp(100)).toBe(1);
    expect(levelFromXp(254)).toBe(1);
    expect(levelFromXp(255)).toBe(2);
  });
});

describe("xp settings API", () => {
  it("serves defaults, stores settings, rejects xpMax < xpMin", async () => {
    const sid = await makeSession("840000000000000001");
    const defaults = (await (await panel(`/api/guilds/${G}/xp-settings`, sid)).json()) as XpSettingsDto;
    expect(defaults.enabled).toBe(false);
    expect(defaults.xpMin).toBe(15);
    expect(defaults.rewards).toEqual([]);

    const put = await panel(`/api/guilds/${G}/xp-settings`, sid, { method: "PUT", body: JSON.stringify(XP100) });
    expect(put.status).toBe(200);
    const read = (await (await panel(`/api/guilds/${G}/xp-settings`, sid)).json()) as XpSettingsDto;
    expect(read.enabled).toBe(true);
    expect(read.rewards).toEqual([{ level: 1, roleId: REWARD_ROLE }]);

    const bad = await panel(`/api/guilds/${G}/xp-settings`, sid, {
      method: "PUT",
      body: JSON.stringify({ ...XP100, xpMin: 50, xpMax: 10 }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("internal xp grant", () => {
  it("skips when disabled", async () => {
    const res = await grant();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { skipped?: boolean }).skipped).toBe(true);
  });

  it("grants xp, levels up, updates the leaderboard", async () => {
    await upsertXpSettings(env.DB, G, XP100);

    const first = await grant();
    const body1 = (await first.json()) as { xp: number; level: number; leveledUp: boolean };
    expect(body1.xp).toBe(100);
    expect(body1.level).toBe(1);
    expect(body1.leveledUp).toBe(true);

    const second = await grant();
    const body2 = (await second.json()) as { xp: number; level: number; leveledUp: boolean };
    expect(body2.xp).toBe(200);
    expect(body2.leveledUp).toBe(false); // level 2 requires 255

    const member = await getXpMember(env.DB, G, USER);
    expect(member?.level).toBe(1);
    expect(member?.messages).toBe(2);
    expect(member?.username).toBe("testeur");

    const sid = await makeSession("840000000000000002");
    const lb = (await (await panel(`/api/guilds/${G}/leaderboard`, sid)).json()) as LeaderboardEntry[];
    expect(lb[0]).toMatchObject({ rank: 1, userId: USER, xp: 200, level: 1, username: "testeur" });
  });
});

describe("internal voice xp grant (M22)", () => {
  it("skips when voice XP is disabled", async () => {
    await upsertXpSettings(env.DB, G, XP100); // voiceEnabled: false
    const res = await grantVoice([{ userId: VUSER, channelId: CHANNEL }]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { skipped?: boolean }).skipped).toBe(true);
  });

  it("grants voice xp + minutes without touching messages, and levels up", async () => {
    await upsertXpSettings(env.DB, G, { ...XP100, voiceEnabled: true, voiceXpPerMin: 100 });

    const res = await grantVoice([{ userId: VUSER, username: "voix", channelId: CHANNEL }]);
    const body = (await res.json()) as { ok: boolean; granted: number };
    expect(body.granted).toBe(1);

    const member = await getXpMember(env.DB, G, VUSER);
    expect(member?.xp).toBe(100);
    expect(member?.voice_minutes).toBe(1);
    expect(member?.messages).toBe(0); // voice XP never increments the message count
    expect(member?.level).toBe(1); // 100 XP = level 1

    // A second tick accumulates minutes and XP.
    await grantVoice([{ userId: VUSER, username: "voix", channelId: CHANNEL }]);
    const after = await getXpMember(env.DB, G, VUSER);
    expect(after?.xp).toBe(200);
    expect(after?.voice_minutes).toBe(2);
  });
});
