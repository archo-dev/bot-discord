import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import {
  commandLogicV1Schema,
  isAllowedWebhookUrl,
  substituteVariables,
  type CommandCondition,
} from "@bot/shared";
import { evaluateConditions } from "../src/engine/conditions.js";
import { remainingCooldown, startCooldown } from "../src/engine/cooldown.js";
import { executeAction } from "../src/engine/actions.js";
import { upsertGuild, getCounterValues } from "../src/db/queries.js";

const G = "920000000000000001";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

// ---------------------------------------------------------------------------
// Schema whitelist — the security boundary
// ---------------------------------------------------------------------------

describe("command logic schema", () => {
  const valid = {
    version: 1,
    trigger: { type: "slash", name: "welcome" },
    actions: [{ type: "reply", content: "Bienvenue {mention} !" }],
  };

  it("accepts a minimal valid command and applies defaults", () => {
    const parsed = commandLogicV1Schema.parse(valid);
    expect(parsed.conditionMode).toBe("all");
    expect(parsed.cooldown).toEqual({ seconds: 0, scope: "user" });
    expect(parsed.requiredPermissions).toBeNull();
  });

  const rejected: Array<[string, unknown]> = [
    ["reserved built-in name", { ...valid, trigger: { type: "slash", name: "ban" } }],
    ["uppercase name", { ...valid, trigger: { type: "slash", name: "Hello" } }],
    ["empty actions", { ...valid, actions: [] }],
    [
      "more than 5 actions",
      { ...valid, actions: Array.from({ length: 6 }, () => ({ type: "increment_counter", counter: "x", amount: 1 })) },
    ],
    [
      "two reply actions",
      { ...valid, actions: [{ type: "reply", content: "a" }, { type: "reply", content: "b" }] },
    ],
    ["reply without content or embed", { ...valid, actions: [{ type: "reply" }] }],
    ["unknown action type", { ...valid, actions: [{ type: "eval", code: "1+1" }] }],
    ["http webhook", { ...valid, actions: [{ type: "call_webhook", url: "http://example.com/h", method: "POST", includeContext: false }] }],
    ["IP-literal webhook", { ...valid, actions: [{ type: "call_webhook", url: "https://10.0.0.1/h", method: "POST", includeContext: false }] }],
    ["localhost webhook", { ...valid, actions: [{ type: "call_webhook", url: "https://localhost/h", method: "POST", includeContext: false }] }],
    [".internal webhook", { ...valid, actions: [{ type: "call_webhook", url: "https://db.prod.internal/h", method: "POST", includeContext: false }] }],
    ["more than 10 conditions", { ...valid, conditions: Array.from({ length: 11 }, () => ({ type: "channel_is", channelId: "123456789" })) }],
    ["cooldown above 24h", { ...valid, cooldown: { seconds: 90000, scope: "user" } }],
    ["non-numeric permission bitfield", { ...valid, requiredPermissions: "abc" }],
    ["version 2 document", { ...valid, version: 2 }],
  ];

  it.each(rejected)("rejects: %s", (_label, doc) => {
    expect(commandLogicV1Schema.safeParse(doc).success).toBe(false);
  });

  it("accepts keyword triggers (stored for the future gateway)", () => {
    const parsed = commandLogicV1Schema.parse({
      ...valid,
      trigger: { type: "keyword", name: "hello", keywords: ["salut"], matchMode: "contains" },
    });
    expect(parsed.trigger.type).toBe("keyword");
  });
});

describe("webhook URL guard", () => {
  it.each([
    ["https://hooks.example.com/x", true],
    ["https://example.com", true],
    ["http://example.com", false],
    ["https://127.0.0.1/x", false],
    ["https://[::1]/x", false],
    ["https://localhost:8080/x", false],
    ["https://foo.localhost/x", false],
    ["https://service.local/x", false],
    ["https://intranet/x", false],
    ["not a url", false],
  ])("%s → %s", (url, expected) => {
    expect(isAllowedWebhookUrl(url)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

describe("variable substitution", () => {
  const ctx = {
    userName: "Alice",
    userId: "42",
    serverName: "Mon Serveur",
    memberCount: 150,
    channelId: "777",
    counters: { visites: 12 },
  };

  it("substitutes every whitelisted variable", () => {
    expect(
      substituteVariables("{user} {mention} {user.id} {server} {membercount} {channel} {counter:visites}", ctx),
    ).toBe("Alice <@42> 42 Mon Serveur 150 <#777> 12");
  });

  it("unknown counters render as 0 and unknown braces stay literal", () => {
    expect(substituteVariables("{counter:nope} {pas_une_variable}", ctx)).toBe("0 {pas_une_variable}");
  });
});

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

describe("condition evaluation", () => {
  const ctx = {
    memberRoles: ["100", "200"],
    memberPermissions: "8192", // MANAGE_MESSAGES
    channelId: "777",
    counters: { score: 10 },
  };

  const cases: Array<[string, CommandCondition[], "all" | "any", boolean]> = [
    ["has role", [{ type: "user_has_role", roleId: "100" }], "all", true],
    ["lacks role", [{ type: "user_lacks_role", roleId: "300" }], "all", true],
    ["wrong channel", [{ type: "channel_is", channelId: "778" }], "all", false],
    ["has permission", [{ type: "user_has_permission", permission: "8192" }], "all", true],
    ["missing permission", [{ type: "user_has_permission", permission: "8" }], "all", false],
    ["counter gte", [{ type: "counter_compare", counter: "score", op: "gte", value: 10 }], "all", true],
    ["counter lt on missing counter (0)", [{ type: "counter_compare", counter: "missing", op: "lt", value: 1 }], "all", true],
    [
      "all: one fails → false",
      [
        { type: "user_has_role", roleId: "100" },
        { type: "channel_is", channelId: "778" },
      ],
      "all",
      false,
    ],
    [
      "any: one passes → true",
      [
        { type: "user_has_role", roleId: "999" },
        { type: "channel_is", channelId: "777" },
      ],
      "any",
      true,
    ],
    ["empty conditions always pass", [], "all", true],
  ];

  it.each(cases)("%s", (_label, conditions, mode, expected) => {
    expect(evaluateConditions(conditions, mode, ctx)).toBe(expected);
  });

  it("ADMINISTRATOR implies any permission condition", () => {
    expect(
      evaluateConditions([{ type: "user_has_permission", permission: "8192" }], "all", { ...ctx, memberPermissions: "8" }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cooldown (KV, sub-60s expiry stored in the value)
// ---------------------------------------------------------------------------

describe("cooldown", () => {
  it("tracks per-user cooldowns and reports remaining seconds", async () => {
    expect(await remainingCooldown(env, G, 1, "user", "u1")).toBe(0);
    await startCooldown(env, G, 1, "user", "u1", 30);
    const remaining = await remainingCooldown(env, G, 1, "user", "u1");
    expect(remaining).toBeGreaterThan(25);
    expect(remaining).toBeLessThanOrEqual(30);
    // other users unaffected in user scope
    expect(await remainingCooldown(env, G, 1, "user", "u2")).toBe(0);
  });

  it("guild scope is shared across users", async () => {
    await startCooldown(env, G, 2, "guild", "u1", 60);
    expect(await remainingCooldown(env, G, 2, "guild", "u2")).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

describe("action executors", () => {
  const vars = { userName: "Alice", userId: "42", serverName: "S", memberCount: null, channelId: "777", counters: {} };
  const ctx = { env, guildId: G, userId: "42", channelId: "777", vars };

  it("increment_counter writes through to D1", async () => {
    await upsertGuild(env.DB, G, "Engine Guild", null);
    await executeAction({ type: "increment_counter", counter: "uses", amount: 3 }, ctx);
    await executeAction({ type: "increment_counter", counter: "uses", amount: -1 }, ctx);
    expect(await getCounterValues(env.DB, G, ["uses"])).toEqual({ uses: 2 });
  });

  it("send_message refuses channels belonging to another guild", async () => {
    fetchMock
      .get("https://discord.com")
      .intercept({ path: "/api/v10/channels/666000000000000001", method: "GET" })
      .reply(200, { id: "666000000000000001", guild_id: "OTHER_GUILD" });
    await expect(
      executeAction({ type: "send_message", channelId: "666000000000000001", content: "hi" }, ctx),
    ).rejects.toThrow(/not in this guild/);
  });

  it("send_message posts to a same-guild channel with variables substituted", async () => {
    let sentBody: string | undefined;
    fetchMock
      .get("https://discord.com")
      .intercept({ path: "/api/v10/channels/666000000000000002", method: "GET" })
      .reply(200, { id: "666000000000000002", guild_id: G });
    fetchMock
      .get("https://discord.com")
      .intercept({
        path: "/api/v10/channels/666000000000000002/messages",
        method: "POST",
        body: (b) => {
          sentBody = b as string;
          return true;
        },
      })
      .reply(200, { id: "m1" });
    await executeAction({ type: "send_message", channelId: "666000000000000002", content: "Bienvenue {user} !" }, ctx);
    expect(sentBody).toContain("Bienvenue Alice !");
  });

  it("call_webhook re-rejects forbidden URLs at execution time", async () => {
    await expect(
      executeAction({ type: "call_webhook", url: "https://127.0.0.1/x", method: "POST", includeContext: false }, ctx),
    ).rejects.toThrow(/rejected/);
  });

  it("reply is never executed as a REST action", async () => {
    await expect(executeAction({ type: "reply", content: "x" }, ctx)).rejects.toThrow();
  });
});
