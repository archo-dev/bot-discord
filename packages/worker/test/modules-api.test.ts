import { beforeAll, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import { MODULE_IDS, type GuildModuleDto, type GuildModulesResponse } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { replacePanelAccess, upsertGuild } from "../src/db/queries.js";

const GUILD_A = "941000000000000001";
const GUILD_B = "941000000000000002";
const MANAGER = "841000000000000001";
const MODERATOR = "841000000000000002";

async function session(userId: string): Promise<string> {
  return createSession(env, {
    userId,
    username: "modules-user",
    globalName: null,
    avatar: null,
    accessToken: `modules-${userId}`,
    refreshToken: "unused",
    tokenExpiresAt: Date.now() + 3_600_000,
    createdAt: Date.now(),
  });
}

function call(path: string, sid: string, method = "GET", body?: unknown) {
  const ctx = createExecutionContext();
  const response = app.request(path, {
    method,
    headers: { cookie: `session=${sid}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, ctx);
  return { response, ctx };
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await Promise.all([
    upsertGuild(env.DB, GUILD_A, "Modules A", null),
    upsertGuild(env.DB, GUILD_B, "Modules B", null),
  ]);
  await replacePanelAccess(env.DB, GUILD_A, [{ subjectType: "user", subjectId: MODERATOR, level: "moderator" }], MANAGER);
  fetchMock.get("https://discord.com").intercept({ path: "/api/v10/users/@me/guilds", method: "GET" }).reply((request) => {
    const authorization = String((request.headers as Record<string, string>)["authorization"] ?? "");
    return { statusCode: 200, data: [
      { id: GUILD_A, name: "Modules A", icon: null, owner: false, permissions: authorization.includes(MANAGER) ? "32" : "0" },
      { id: GUILD_B, name: "Modules B", icon: null, owner: false, permissions: "0" },
    ] };
  }).persist();
});

describe("M03 module governance API", () => {
  it("returns the bounded registry and exposes offline Gateway state", async () => {
    const sid = await session(MANAGER);
    const response = await call(`/api/guilds/${GUILD_A}/modules`, sid).response;
    expect(response.status).toBe(200);
    const body = await response.json() as GuildModulesResponse;
    expect(body.modules).toHaveLength(MODULE_IDS.length);
    expect(body.gateway).toEqual({ online: false, runtimeChecksAvailable: false });
    expect(body.modules.find((module) => module.id === "music")?.state).toBe("gateway_offline");
  });

  it("keeps moderators read-only and prevents cross-guild access", async () => {
    const moderator = await session(MODERATOR);
    const read = await call(`/api/guilds/${GUILD_A}/modules`, moderator).response;
    const body = await read.json() as GuildModulesResponse;
    expect(read.status).toBe(200);
    expect(body.modules.every((module) => !module.actions.canEnable && !module.actions.canDisable && !module.actions.canConfigure)).toBe(true);
    expect((await call(`/api/guilds/${GUILD_A}/modules/custom_commands`, moderator, "PATCH", { enabled: false }).response).status).toBe(403);
    expect((await call(`/api/guilds/${GUILD_B}/modules`, moderator).response).status).toBe(403);
  });

  it("persists an explicit toggle and records the classified mutation", async () => {
    const sid = await session(MANAGER);
    const disable = call(`/api/guilds/${GUILD_A}/modules/custom_commands`, sid, "PATCH", { enabled: false });
    const response = await disable.response;
    expect(response.status).toBe(200);
    expect((await response.json() as GuildModuleDto).state).toBe("disabled");
    await waitOnExecutionContext(disable.ctx);

    const audit = await env.DB.prepare(
      `SELECT capability, method, outcome FROM admin_audit_log WHERE guild_id = ?1 AND actor_id = ?2 ORDER BY id DESC LIMIT 1`,
    ).bind(GUILD_A, MANAGER).first<{ capability: string; method: string; outcome: string }>();
    expect(audit).toEqual({ capability: "guild_config_write", method: "PATCH", outcome: "success" });

    const enabled = await call(`/api/guilds/${GUILD_A}/modules/custom_commands`, sid, "PATCH", { enabled: true }).response;
    expect(enabled.status).toBe(200);
    expect((await enabled.json() as GuildModuleDto).enabled).toBe(true);
  });

  it("rejects unsafe activation and reports incompatible config versions", async () => {
    const sid = await session(MANAGER);
    await env.DB.prepare(
      `UPDATE guild_modules SET enabled = 0, authority = 'governance' WHERE guild_id = ?1 AND module_id = 'tickets'`,
    ).bind(GUILD_A).run();
    const tickets = await call(`/api/guilds/${GUILD_A}/modules/tickets`, sid, "PATCH", { enabled: true }).response;
    expect(tickets.status).toBe(409);
    expect((await tickets.json() as { error: string }).error).toBe("module_prerequisite_failed");

    await env.DB.prepare(
      `UPDATE guild_modules SET enabled = 1, config_version = 999, authority = 'governance' WHERE guild_id = ?1 AND module_id = 'social'`,
    ).bind(GUILD_A).run();
    const response = await call(`/api/guilds/${GUILD_A}/modules`, sid).response;
    const body = await response.json() as GuildModulesResponse;
    expect(body.modules.find((module) => module.id === "social")?.state).toBe("incompatible_config");
  });
});
