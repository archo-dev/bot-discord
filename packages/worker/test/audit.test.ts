import { beforeAll, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { insertAdminAudit, replacePanelAccess, upsertGuild } from "../src/db/queries.js";

const GUILD = "930000000000000001";
const ADMIN = "830000000000000001";
const MODERATOR = "830000000000000002";

async function session(userId: string): Promise<string> {
  return createSession(env, {
    userId,
    username: `user-${userId.slice(-1)}`,
    globalName: null,
    avatar: null,
    accessToken: `token-${userId}`,
    tokenExpiresAt: Date.now() + 3_600_000,
    createdAt: Date.now(),
  });
}

async function get(path: string, sid: string): Promise<Response> {
  return app.request(path, { headers: { cookie: `session=${sid}` } }, env, createExecutionContext());
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, GUILD, "Audit Guild", null);
  await replacePanelAccess(env.DB, GUILD, [
    { subjectType: "user", subjectId: ADMIN, level: "admin" },
    { subjectType: "user", subjectId: MODERATOR, level: "moderator" },
  ], "owner");
  fetchMock.get("https://discord.com").intercept({ path: "/api/v10/users/@me/guilds", method: "GET" }).reply(200, [
    { id: GUILD, name: "Audit Guild", icon: null, owner: false, permissions: "0" },
  ]).persist();

  for (let index = 1; index <= 30; index++) {
    await insertAdminAudit(env.DB, {
      guildId: GUILD,
      actorId: ADMIN,
      actorAccess: "panel_admin",
      capability: index % 2 === 0 ? "commands_write" : "guild_config_write",
      method: index % 2 === 0 ? "POST" : "PATCH",
      targetType: index % 2 === 0 ? "command" : null,
      targetId: index % 2 === 0 ? String(index) : null,
      outcome: index % 3 === 0 ? "error" : "success",
      status: index % 3 === 0 ? 409 : 200,
      requestId: `audit-request-${String(index).padStart(2, "0")}`,
    });
  }
});

describe("M02 administrative audit API", () => {
  it("reserves audit history to full administrators", async () => {
    const response = await get(`/api/guilds/${GUILD}/audit`, await session(MODERATOR));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("paginates with a bounded keyset cursor and exposes no payload", async () => {
    const sid = await session(ADMIN);
    const first = await get(`/api/guilds/${GUILD}/audit?limit=10`, sid);
    expect(first.status).toBe(200);
    const page = await first.json() as { items: Array<Record<string, unknown>>; nextCursor: string; retentionDays: number };
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toMatch(/^\d+$/);
    expect(page.retentionDays).toBe(90);
    expect(page.items[0]).not.toHaveProperty("guildId");
    expect(page.items[0]).not.toHaveProperty("body");
    expect(page.items[0]).not.toHaveProperty("payload");
    expect(page.items[0]).not.toHaveProperty("token");

    const second = await get(`/api/guilds/${GUILD}/audit?limit=10&cursor=${page.nextCursor}`, sid);
    const secondPage = await second.json() as { items: Array<{ id: number }> };
    expect(secondPage.items).toHaveLength(10);
    expect(new Set([...page.items.map((item) => item.id), ...secondPage.items.map((item) => item.id)]).size).toBe(20);
  });

  it("applies finite server-side filters and rejects unbounded input", async () => {
    const sid = await session(ADMIN);
    const response = await get(`/api/guilds/${GUILD}/audit?capability=commands_write&outcome=error&limit=50`, sid);
    const page = await response.json() as { items: Array<{ capability: string; outcome: string }> };
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.capability === "commands_write" && item.outcome === "error")).toBe(true);
    expect((await get(`/api/guilds/${GUILD}/audit?limit=51`, sid)).status).toBe(400);
    expect((await get(`/api/guilds/${GUILD}/audit?capability=unknown`, sid)).status).toBe(400);
    expect((await get(`/api/guilds/${GUILD}/audit?cursor=not-a-number`, sid)).status).toBe(400);
  });
});
