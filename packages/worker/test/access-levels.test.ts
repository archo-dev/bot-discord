import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { replacePanelAccess, upsertGuild } from "../src/db/queries.js";

// M15 — two-tier panel permissions: admin grants keep full access, moderator
// grants are read-only (every write verb under the guild is 403).

const GUILD = "920000000000000001";
const ADMIN_GRANTEE = "820000000000000010";
const MOD_GRANTEE = "820000000000000011";
const MOD_BY_ROLE = "820000000000000012";
const MOD_ROLE = "620000000000000001";

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

function request(path: string, sessionId: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      { ...init, headers: { cookie: `session=${sessionId}`, "content-type": "application/json" } },
      env,
      createExecutionContext(),
    ),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  await upsertGuild(env.DB, GUILD, "Level Guild", null);
  await replacePanelAccess(
    env.DB,
    GUILD,
    [
      { subjectType: "user", subjectId: ADMIN_GRANTEE, level: "admin" },
      { subjectType: "user", subjectId: MOD_GRANTEE, level: "moderator" },
      { subjectType: "role", subjectId: MOD_ROLE, level: "moderator" },
    ],
    "owner",
  );

  // No grantee has Discord-side MANAGE_GUILD: access must come from panel_access.
  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: GUILD, name: "Level Guild", icon: null, owner: false, permissions: "0" }])
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/guilds/${GUILD}?with_counts=true`, method: "GET" })
    .reply(200, { id: GUILD, name: "Level Guild", icon: null, approximate_member_count: 7 })
    .persist();
  // Member lookup for the role-grant user: carries the moderator role.
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/guilds/${GUILD}/members/${MOD_BY_ROLE}`, method: "GET" })
    .reply(200, { roles: [MOD_ROLE] })
    .persist();
});

describe("panel access levels (M15)", () => {
  it("reports the tier in the guild overview", async () => {
    const adminSid = await makeSession(ADMIN_GRANTEE);
    const modSid = await makeSession(MOD_GRANTEE);

    const adminBody = (await (await request(`/api/guilds/${GUILD}`, adminSid)).json()) as { access: string };
    expect(adminBody.access).toBe("admin");

    const modBody = (await (await request(`/api/guilds/${GUILD}`, modSid)).json()) as { access: string };
    expect(modBody.access).toBe("moderator");
  });

  it("blocks every write verb for moderators with 403 read_only_access", async () => {
    const modSid = await makeSession(MOD_GRANTEE);

    const patch = await request(`/api/guilds/${GUILD}/config`, modSid, {
      method: "PATCH",
      body: JSON.stringify({ warnThreshold: 5 }),
    });
    expect(patch.status).toBe(403);
    expect(((await patch.json()) as { error: string }).error).toBe("read_only_access");

    const put = await request(`/api/guilds/${GUILD}/auto-roles`, modSid, {
      method: "PUT",
      body: JSON.stringify([]),
    });
    expect(put.status).toBe(403);

    const post = await request(`/api/guilds/${GUILD}/commands`, modSid, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(post.status).toBe(403);
  });

  it("keeps GET routes open to moderators, including via role grants", async () => {
    const modSid = await makeSession(MOD_BY_ROLE);
    expect((await request(`/api/guilds/${GUILD}`, modSid)).status).toBe(200);
    expect((await request(`/api/guilds/${GUILD}/auto-roles`, modSid)).status).toBe(200);
  });

  it("lets admin grants write", async () => {
    const adminSid = await makeSession(ADMIN_GRANTEE);
    const patch = await request(`/api/guilds/${GUILD}/config`, adminSid, {
      method: "PATCH",
      body: JSON.stringify({ warnThreshold: 5 }),
    });
    expect(patch.status).toBe(200);
  });

  it("still reserves panel-access management to MANAGE_GUILD", async () => {
    const adminSid = await makeSession(ADMIN_GRANTEE);
    expect((await request(`/api/guilds/${GUILD}/panel-access`, adminSid)).status).toBe(403);
  });
});
