import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import type { APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
import { executeCustomCommand } from "../src/interactions/custom.js";
import type { CustomCommandRow } from "../src/db/queries.js";
import { getCounterValues, upsertGuild } from "../src/db/queries.js";

const G = "930000000000000001";

function makeInteraction(overrides: { roles?: string[]; permissions?: string } = {}): APIChatInputApplicationCommandInteraction {
  return {
    type: 2,
    id: "1",
    application_id: "100000000000000000",
    token: "interaction-token",
    version: 1,
    guild_id: G,
    channel: { id: "940000000000000001", type: 0 },
    channel_id: "940000000000000001",
    member: {
      user: { id: "950000000000000001", username: "alice", global_name: "Alice", discriminator: "0", avatar: null },
      roles: overrides.roles ?? ["960000000000000001"],
      permissions: overrides.permissions ?? "0",
    },
    data: { id: "2", type: 1, name: "test" },
  } as unknown as APIChatInputApplicationCommandInteraction;
}

let seq = 100;
function makeRow(logic: object): CustomCommandRow {
  return {
    id: seq++,
    guild_id: G,
    name: "test",
    description: "d",
    trigger_type: "slash",
    enabled: 1,
    logic: JSON.stringify(logic),
    logic_version: 1,
    cooldown_seconds: 0,
    cooldown_scope: "user",
    required_permissions: null,
    discord_command_id: null,
    created_by: "x",
    created_at: "now",
    updated_at: null,
  };
}

async function run(
  logic: object,
  overrides: { roles?: string[]; permissions?: string } = {},
): Promise<{ res: Response; body: { type: number; data?: { content?: string; flags?: number } }; background: Promise<unknown[]> }> {
  const pending: Promise<unknown>[] = [];
  const res = await executeCustomCommand(env, makeInteraction(overrides), makeRow(logic), (p) => pending.push(p));
  const body = (await res.json()) as { type: number; data?: { content?: string; flags?: number } };
  return { res, body, background: Promise.all(pending) };
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, G, "Serveur Test", null);
});

describe("custom command executor", () => {
  it("fast path: single reply with substituted variables", async () => {
    const { body } = await run({
      version: 1,
      trigger: { type: "slash", name: "test" },
      actions: [{ type: "reply", content: "Salut {user} sur {server} !" }],
    });
    expect(body.type).toBe(4);
    expect(body.data?.content).toBe("Salut Alice sur Serveur Test !");
    expect(body.data?.flags).toBeUndefined();
  });

  it("blocks users missing requiredPermissions", async () => {
    const { body } = await run(
      {
        version: 1,
        trigger: { type: "slash", name: "test" },
        actions: [{ type: "reply", content: "ok" }],
        requiredPermissions: "8192",
      },
      { permissions: "0" },
    );
    expect(body.type).toBe(4);
    expect(body.data?.content).toContain("permission");
    expect(body.data?.flags).toBe(64);
  });

  it("failed conditions use the elseActions reply", async () => {
    const { body } = await run(
      {
        version: 1,
        trigger: { type: "slash", name: "test" },
        conditions: [{ type: "user_has_role", roleId: "999999999999999999" }],
        actions: [{ type: "reply", content: "secret" }],
        elseActions: [{ type: "reply", content: "Pas pour toi, {user}.", ephemeral: true }],
      },
    );
    expect(body.data?.content).toBe("Pas pour toi, Alice.");
    expect(body.data?.flags).toBe(64);
  });

  it("cooldown: second call within the window is refused", async () => {
    const logic = {
      version: 1,
      trigger: { type: "slash", name: "test" },
      actions: [{ type: "reply", content: "ok" }],
      cooldown: { seconds: 120, scope: "user" },
    };
    const row = makeRow(logic);
    const pending: Promise<unknown>[] = [];
    const first = await executeCustomCommand(env, makeInteraction(), row, (p) => pending.push(p));
    expect(((await first.json()) as { data: { content: string } }).data.content).toBe("ok");
    await Promise.all(pending);

    const second = await executeCustomCommand(env, makeInteraction(), row, () => {});
    const body = (await second.json()) as { data: { content: string } };
    expect(body.data.content).toContain("cooldown");
  });

  it("slow path: defers, runs the chain, edits the original response", async () => {
    let patched: string | undefined;
    fetchMock
      .get("https://discord.com")
      .intercept({
        path: /\/api\/v10\/webhooks\/100000000000000000\/interaction-token\/messages\/(@|%40)original/,
        method: "PATCH",
        body: (b) => {
          patched = b as string;
          return true;
        },
      })
      .reply(200, {});

    const { body, background } = await run({
      version: 1,
      trigger: { type: "slash", name: "test" },
      actions: [
        { type: "increment_counter", counter: "runs", amount: 1 },
        { type: "reply", content: "Compteur : {counter:runs}" },
      ],
    });
    expect(body.type).toBe(5); // deferred
    await background;
    expect(await getCounterValues(env.DB, G, ["runs"])).toEqual({ runs: 1 });
    expect(patched).toBeDefined();
  });

  it("rejects rows whose stored logic no longer validates", async () => {
    const { body } = await run({ version: 1, trigger: { type: "slash", name: "test" }, actions: [{ type: "eval", code: "x" }] });
    expect(body.data?.content).toContain("mal configurée");
  });
});
