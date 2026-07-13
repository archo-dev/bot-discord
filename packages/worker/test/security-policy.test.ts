import { beforeAll, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock } from "cloudflare:test";
import { PANEL_MUTATION_POLICIES, isPanelMutationAllowed, matchPanelMutationPolicy } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { replacePanelAccess, upsertGuild } from "../src/db/queries.js";

const GUILD_A = "970000000000000001";
const GUILD_B = "970000000000000002";
const MANAGER = "870000000000000001";
const ADMIN = "870000000000000002";
const MODERATOR = "870000000000000003";
const OUTSIDER = "870000000000000004";

async function session(userId: string): Promise<string> {
  return createSession(env, {
    userId, username: "security-user", globalName: null, avatar: null,
    accessToken: `security-${userId}`, refreshToken: "unused",
    tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
}

function request(path: string, sid: string, method = "GET"): Promise<Response> {
  return Promise.resolve(app.request(path, {
    method,
    headers: { cookie: `session=${sid}`, "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: "{}" }),
  }, env, createExecutionContext()));
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await Promise.all([upsertGuild(env.DB, GUILD_A, "A", null), upsertGuild(env.DB, GUILD_B, "B", null)]);
  await replacePanelAccess(env.DB, GUILD_A, [
    { subjectType: "user", subjectId: ADMIN, level: "admin" },
    { subjectType: "user", subjectId: MODERATOR, level: "moderator" },
  ], MANAGER);
  fetchMock.get("https://discord.com").intercept({ path: "/api/v10/users/@me/guilds", method: "GET" }).reply((req) => {
    const authorization = String((req.headers as Record<string, string>)["authorization"] ?? "");
    const manager = authorization.includes(MANAGER);
    return { statusCode: 200, data: [
      { id: GUILD_A, name: "A", icon: null, owner: false, permissions: manager ? "32" : "0" },
      { id: GUILD_B, name: "B", icon: null, owner: false, permissions: "0" },
    ] };
  }).persist();
  fetchMock.get("https://discord.com").intercept({ path: `/api/v10/guilds/${GUILD_A}?with_counts=true`, method: "GET" })
    .reply(200, { id: GUILD_A, name: "A", icon: null, approximate_member_count: 1 }).persist();
});

describe("M02 panel mutation policy", () => {
  it("versions all 20 current mutations", () => {
    expect(PANEL_MUTATION_POLICIES).toHaveLength(20);
    for (const policy of PANEL_MUTATION_POLICIES) {
      const concrete = policy.path.replace(":guildId", "910000000000000001").replace(":warnId", "1").replace(":id", "1");
      expect(matchPanelMutationPolicy(policy.method, concrete)).toEqual(policy);
    }
  });

  it("denies unknown mutations and grants only classified access levels", () => {
    expect(matchPanelMutationPolicy("POST", "/api/guilds/910000000000000001/future-feature")).toBeNull();
    for (const policy of PANEL_MUTATION_POLICIES) {
      expect(isPanelMutationAllowed(policy, "panel_moderator")).toBe(false);
      expect(isPanelMutationAllowed(policy, "manage_guild")).toBe(true);
      expect(isPanelMutationAllowed(policy, "panel_admin")).toBe(policy.capability !== "panel_access_manage");
    }
  });

  it("prevents a manager of guild A from reading guild B", async () => {
    const sid = await session(MANAGER);
    expect((await request(`/api/guilds/${GUILD_A}`, sid)).status).toBe(200);
    expect((await request(`/api/guilds/${GUILD_B}`, sid)).status).toBe(403);
  });

  it("table-denies all 20 mutations to moderators and outsiders", async () => {
    const [moderator, outsider] = await Promise.all([session(MODERATOR), session(OUTSIDER)]);
    for (const policy of PANEL_MUTATION_POLICIES) {
      const path = policy.path.replace(":guildId", GUILD_A).replace(":warnId", "1").replace(":id", "1");
      const modResponse = await request(path, moderator, policy.method);
      expect(modResponse.status, `${policy.method} ${policy.path} moderator`).toBe(403);
      expect(((await modResponse.json()) as { error: string }).error).toBe("read_only_access");
      expect((await request(path, outsider, policy.method)).status, `${policy.method} ${policy.path} outsider`).toBe(403);
    }
  });
});
