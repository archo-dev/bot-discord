import { beforeAll, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import type { AutomationCatalogDto, AutomationExportEnvelope, AutomationRevisionDto, AutomationSimulationResult, AutomationWorkflowDto, AutomationWorkflowInput } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { upsertGuild } from "../src/db/queries.js";

const GUILD = "991000000000000030";
const MANAGER = "881000000000000030";
let sid: string;

const workflow = (name: string): AutomationWorkflowInput => ({
  schemaVersion: 1, name, description: "API test", enabled: false,
  trigger: { type: "message_create", config: { ignoreBots: true } },
  conditions: [{ type: "message_contains", config: { value: "hello", caseSensitive: false }, negate: false }], conditionMode: "all",
  actions: [{ type: "send_message", config: { content: "Hello {{user.name}}" }, continueOnError: false }],
  cooldownSeconds: 10, cooldownScope: "user", maxRunsPerMinute: 5,
});

function call(path: string, method = "GET", body?: unknown) {
  const ctx = createExecutionContext();
  const response = app.request(path, { method, headers: { cookie: `session=${sid}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env, ctx);
  return { response, ctx };
}

beforeAll(async () => {
  fetchMock.activate(); fetchMock.disableNetConnect();
  await upsertGuild(env.DB, GUILD, "Automation API", null);
  sid = await createSession(env, { userId: MANAGER, username: "automation-manager", globalName: null, avatar: null, accessToken: "automation-manager", refreshToken: "unused", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now() });
  fetchMock.get("https://discord.com").intercept({ path: "/api/v10/users/@me/guilds", method: "GET" }).reply(200, [{ id: GUILD, name: "Automation API", icon: null, owner: false, permissions: "32" }]).persist();
});

describe("Automation Studio API", () => {
  it("serves the complete catalog and rejects an invalid workflow", async () => {
    const catalogResponse = await call(`/api/guilds/${GUILD}/automations/catalog`).response;
    const catalog = await catalogResponse.json() as AutomationCatalogDto;
    expect(catalogResponse.status).toBe(200);
    expect([catalog.triggers.length, catalog.conditions.length, catalog.actions.length]).toEqual([17, 17, 20]);
    expect((await call(`/api/guilds/${GUILD}/automations`, "POST", { name: "bad" }).response).status).toBe(400);
  });

  it("creates, updates, versions and simulates without side effects", async () => {
    const creation = call(`/api/guilds/${GUILD}/automations`, "POST", workflow("API workflow"));
    const response = await creation.response; const created = await response.json() as AutomationWorkflowDto;
    expect(response.status).toBe(201); expect(created.revision).toBe(1);
    await waitOnExecutionContext(creation.ctx);

    const update = await call(`/api/guilds/${GUILD}/automations/${created.id}`, "PUT", { ...workflow("API workflow"), description: "updated" }).response;
    expect(update.status).toBe(200); expect((await update.json() as AutomationWorkflowDto).revision).toBe(2);
    const revisions = await (await call(`/api/guilds/${GUILD}/automations/${created.id}/revisions`).response).json() as AutomationRevisionDto[];
    expect(revisions.map((item) => item.revision)).toEqual([2, 1]);

    const simulation = await call(`/api/guilds/${GUILD}/automations/${created.id}/simulate`, "POST", { event: { type: "message_create", depth: 0 }, guild: { id: GUILD }, user: { id: MANAGER, name: "Alice" }, message: { id: "771000000000000030", content: "hello" } }).response;
    const result = await simulation.json() as AutomationSimulationResult;
    expect(simulation.status).toBe(200); expect(result.matched).toBe(true); expect(result.actions).toHaveLength(1);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM automation_executions WHERE guild_id=?1").bind(GUILD).first<{ n: number }>())?.n).toBe(0);
  });

  it("exports a portable definition, validates import and creates an inactive duplicate", async () => {
    const created = await (await call(`/api/guilds/${GUILD}/automations`, "POST", workflow("API workflow")).response).json() as AutomationWorkflowDto;
    const exported = await (await call(`/api/guilds/${GUILD}/automations/${created.id}/export`).response).json() as AutomationExportEnvelope;
    expect(exported.workflow.name).toBe("API workflow");
    expect("id" in exported.workflow).toBe(false);
    const validation = await call(`/api/guilds/${GUILD}/automations/import/validate`, "POST", { ...exported, workflow: { ...exported.workflow, name: "Imported API workflow" } }).response;
    expect(validation.status).toBe(200); expect((await validation.json() as { valid: boolean }).valid).toBe(true);
    const imported = await call(`/api/guilds/${GUILD}/automations/import`, "POST", { ...exported, workflow: { ...exported.workflow, name: "Imported API workflow" } }).response;
    expect(imported.status).toBe(201);
    const duplicate = await call(`/api/guilds/${GUILD}/automations/${created.id}/duplicate`, "POST").response;
    expect(duplicate.status).toBe(201); expect((await duplicate.json() as AutomationWorkflowDto).enabled).toBe(false);
  });

  it("deletes with a 204 while retaining the immutable revision trail", async () => {
    const created = await (await call(`/api/guilds/${GUILD}/automations`, "POST", workflow("Delete API workflow")).response).json() as AutomationWorkflowDto;
    const deletion = call(`/api/guilds/${GUILD}/automations/${created.id}`, "DELETE");
    expect((await deletion.response).status).toBe(204); await waitOnExecutionContext(deletion.ctx);
    expect((await call(`/api/guilds/${GUILD}/automations/${created.id}`).response).status).toBe(404);
    const history = await env.DB.prepare("SELECT change_type FROM automation_workflow_revisions WHERE workflow_id=?1 ORDER BY revision DESC LIMIT 1").bind(created.id).first<{ change_type: string }>();
    expect(history?.change_type).toBe("delete");
  });
});
