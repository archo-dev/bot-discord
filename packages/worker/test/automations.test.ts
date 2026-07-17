import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  AUTOMATION_ACTION_IDS,
  AUTOMATION_CATALOG,
  AUTOMATION_CONDITION_IDS,
  AUTOMATION_MAX_DEPTH,
  AUTOMATION_TRIGGER_IDS,
  automationEventContextSchema,
  automationWorkflowInputSchema,
  automationTemplateVariables,
  renderAutomationTemplate,
  type AutomationWorkflowInput,
} from "@bot/shared";
import {
  claimAutomationExecution,
  consumeAutomationEventSuppression,
  consumeAutomationLimit,
  createAutomationWorkflow,
  deleteAutomationWorkflow,
  ensureGuildModules,
  listAutomationRevisions,
  suppressAutomationEvent,
  updateAutomationWorkflow,
  upsertGuild,
} from "../src/db/queries.js";
import { cronMatches, simulateAutomationWorkflow } from "../src/automation/engine.js";
import { assertAutomationRegistryComplete, evaluateAutomationCondition, matchesAutomationTrigger } from "../src/automation/registry.js";

const GUILD = "991000000000000010";
const ACTOR = "881000000000000010";

function workflow(name = `Workflow ${crypto.randomUUID()}`): AutomationWorkflowInput {
  return {
    schemaVersion: 1,
    name,
    description: "test",
    enabled: true,
    trigger: { type: "message_create", config: { ignoreBots: true } },
    conditions: [{ type: "message_contains", config: { value: "help", caseSensitive: false }, negate: false }],
    conditionMode: "all",
    actions: [
      { type: "send_message", config: { content: "Bonjour {{user.name}}" }, continueOnError: false },
      { type: "wait", config: { seconds: 10 }, continueOnError: false },
      { type: "stop_workflow", config: {}, continueOnError: false },
    ],
    cooldownSeconds: 0,
    cooldownScope: "user",
    maxRunsPerMinute: 2,
  };
}

beforeAll(async () => { await upsertGuild(env.DB, GUILD, "Automation tests", null); });

describe("automation catalog and schemas", () => {
  it("registers every MVP trigger, condition and action exactly once", () => {
    expect(() => assertAutomationRegistryComplete()).not.toThrow();
    expect(AUTOMATION_CATALOG.triggers.map((item) => item.id)).toEqual(AUTOMATION_TRIGGER_IDS);
    expect(AUTOMATION_CATALOG.conditions.map((item) => item.id)).toEqual(AUTOMATION_CONDITION_IDS);
    expect(AUTOMATION_CATALOG.actions.map((item) => item.id)).toEqual(AUTOMATION_ACTION_IDS);
    for (const item of [...AUTOMATION_CATALOG.triggers, ...AUTOMATION_CATALOG.conditions, ...AUTOMATION_CATALOG.actions]) {
      expect(item.version).toBe(1);
      expect(item.name).not.toBe("");
      expect(Array.isArray(item.configFields)).toBe(true);
    }
  });

  it("validates portable import/export payloads and rejects unsafe webhooks", () => {
    expect(automationWorkflowInputSchema.safeParse(workflow()).success).toBe(true);
    const unsafe = workflow();
    unsafe.actions = [{ type: "call_webhook", config: { url: "https://127.0.0.1/private", body: {} }, continueOnError: false }];
    expect(automationWorkflowInputSchema.safeParse(unsafe).success).toBe(false);
  });

  it("bounds recursion depth and workflow size", () => {
    const context = { event: { type: "message_create", depth: AUTOMATION_MAX_DEPTH + 1 }, guild: { id: GUILD } };
    expect(automationEventContextSchema.safeParse(context).success).toBe(false);
    expect(automationWorkflowInputSchema.safeParse({ ...workflow(), actions: Array.from({ length: 21 }, () => ({ type: "stop_workflow", config: {} })) }).success).toBe(false);
  });
});

describe("automation templates and evaluation", () => {
  it("renders nested variables, deduplicates discovery and drops unknown values", () => {
    const template = "{{user.name}}/{{user.id}}/{{user.name}}/{{unknown}}";
    expect(automationTemplateVariables(template)).toEqual(["user.name", "user.id", "unknown"]);
    expect(renderAutomationTemplate(template, { user: { name: "Alice", id: "42" } })).toBe("Alice/42/Alice/");
  });

  it("matches triggers and safely evaluates text, role and boolean conditions", async () => {
    const event = automationEventContextSchema.parse({
      event: { type: "message_create", depth: 0 }, guild: { id: GUILD },
      user: { id: "111111111111111111", name: "Alice", bot: false, roleIds: ["222222222222222222"] },
      channel: { id: "333333333333333333", name: "support" }, message: { id: "444444444444444444", content: "Help me" },
    });
    expect(matchesAutomationTrigger({ type: "message_create", config: { ignoreBots: true } }, event)).toBe(true);
    const runtime = { env, workflowId: "test", executionId: "test", guildId: GUILD, event, dryRun: true };
    expect(await evaluateAutomationCondition({ type: "message_contains", config: { value: "help", caseSensitive: false }, negate: false }, runtime)).toBe(true);
    expect(await evaluateAutomationCondition({ type: "user_has_role", config: { roleId: "222222222222222222" }, negate: false }, runtime)).toBe(true);
    expect(await evaluateAutomationCondition({ type: "boolean_expression", config: { expression: "user.bot == false && user.name == 'Alice'" }, negate: false }, runtime)).toBe(true);
  });

  it("matches UTC cron fields including ranges and steps", () => {
    const monday = new Date("2026-07-20T09:30:00.000Z");
    expect(cronMatches("*/15 9 20 7 1", monday)).toBe(true);
    expect(cronMatches("0 9 * * 1-5", monday)).toBe(false);
    expect(cronMatches("invalid", monday)).toBe(false);
  });
});

describe("automation persistence, concurrency and rollback", () => {
  it("claims one execution idempotently under concurrent delivery", async () => {
    const created = await createAutomationWorkflow(env.DB, GUILD, ACTOR, workflow());
    const input = { workflowId: created.id, guildId: GUILD, eventId: crypto.randomUUID(), correlationId: crypto.randomUUID(), triggerType: "message_create" as const, scopeKey: "user:1", actionsTotal: 3 };
    const claims = await Promise.all([claimAutomationExecution(env.DB, input), claimAutomationExecution(env.DB, input)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("enforces the atomic per-minute rate limit under concurrency", async () => {
    const created = await createAutomationWorkflow(env.DB, GUILD, ACTOR, workflow());
    const now = Date.now();
    const accepted = await Promise.all(Array.from({ length: 4 }, () => consumeAutomationLimit(env.DB, created, "user:rate", now)));
    expect(accepted.filter(Boolean)).toHaveLength(2);
  });

  it("suppresses role feedback loops once and lets unrelated events through", async () => {
    const context = automationEventContextSchema.parse({ event: { type: "role_added", depth: 0 }, guild: { id: GUILD }, user: { id: "111111111111111111" }, role: { id: "222222222222222222" } });
    await suppressAutomationEvent(env.DB, GUILD, "role_added", "111111111111111111:222222222222222222");
    expect(await consumeAutomationEventSuppression(env.DB, GUILD, "role_added", context)).toBe(true);
    expect(await consumeAutomationEventSuppression(env.DB, GUILD, "role_added", context)).toBe(false);
  });

  it("does not re-emit D1 domain triggers created by the automation actor", async () => {
    await createAutomationWorkflow(env.DB, GUILD, ACTOR, { ...workflow(), trigger: { type: "warn_created", config: {} }, conditions: [], actions: [{ type: "stop_workflow", config: {}, continueOnError: false }] });
    await ensureGuildModules(env.DB, GUILD);
    await env.DB.prepare("UPDATE guild_module_extensions SET enabled=1 WHERE guild_id=?1 AND module_id='automations'").bind(GUILD).run();
    const before = (await env.DB.prepare("SELECT COUNT(*) n FROM automation_event_queue WHERE guild_id=?1 AND trigger_type='warn_created'").bind(GUILD).first<{ n: number }>())?.n ?? 0;
    await env.DB.prepare("INSERT INTO warnings(guild_id,user_id,moderator_id,reason) VALUES(?1,?2,'automation','loop guard')").bind(GUILD, "111111111111111119").run();
    const afterAutomation = (await env.DB.prepare("SELECT COUNT(*) n FROM automation_event_queue WHERE guild_id=?1 AND trigger_type='warn_created'").bind(GUILD).first<{ n: number }>())?.n ?? 0;
    await env.DB.prepare("INSERT INTO warnings(guild_id,user_id,moderator_id,reason) VALUES(?1,?2,?3,'external')").bind(GUILD, "111111111111111118", ACTOR).run();
    const afterExternal = (await env.DB.prepare("SELECT COUNT(*) n FROM automation_event_queue WHERE guild_id=?1 AND trigger_type='warn_created'").bind(GUILD).first<{ n: number }>())?.n ?? 0;
    expect(afterAutomation).toBe(before);
    expect(afterExternal).toBe(before + 1);
  });

  it("keeps immutable revisions through update and deletion for rollback audit", async () => {
    const created = await createAutomationWorkflow(env.DB, GUILD, ACTOR, workflow());
    await updateAutomationWorkflow(env.DB, GUILD, created.id, ACTOR, { ...created, description: "révision 2" });
    expect(await deleteAutomationWorkflow(env.DB, GUILD, created.id, ACTOR)).toBe(true);
    const revisions = await listAutomationRevisions(env.DB, GUILD, created.id);
    expect(revisions.map((revision) => revision.changeType)).toEqual(["delete", "update", "create"]);
    expect(revisions[1]?.snapshot.description).toBe("révision 2");
  });

  it("simulates matching actions without creating action-run rows", async () => {
    const created = await createAutomationWorkflow(env.DB, GUILD, ACTOR, workflow());
    const before = (await env.DB.prepare("SELECT COUNT(*) n FROM automation_action_runs").first<{ n: number }>())?.n ?? 0;
    const result = await simulateAutomationWorkflow(env, created, {
      event: { type: "message_create", depth: 0 }, guild: { id: GUILD }, user: { id: "111111111111111111", name: "Alice" }, message: { id: "444444444444444444", content: "help" },
    });
    const after = (await env.DB.prepare("SELECT COUNT(*) n FROM automation_action_runs").first<{ n: number }>())?.n ?? 0;
    expect(result.matched).toBe(true);
    expect(result.actions.map((action) => action.type)).toEqual(["send_message", "wait", "stop_workflow"]);
    expect(after).toBe(before);
  });
});
