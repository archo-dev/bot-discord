import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import type { APIChatInputApplicationCommandInteraction, APIUser } from "discord-api-types/v10";
import { banHandler, kickHandler, muteHandler, warnHandler } from "../src/interactions/builtins/moderation.js";
import type { BuiltinContext } from "../src/interactions/builtins/index.js";
import { activeWarningCount, listModActions, updateGuildConfig, upsertGuild } from "../src/db/queries.js";

const G = "970000000000000001";
const MOD = "970000000000000002";
const TARGET = "970000000000000003";
let guildOwnerId = "970000000000000099";

const targetUser: APIUser = {
  id: TARGET,
  username: "cible",
  global_name: "Cible",
  discriminator: "0",
  avatar: null,
} as APIUser;

function makeCtx(
  name: string,
  opts: { permissions: string; options?: Array<{ name: string; type: number; value: string | number }> },
): BuiltinContext & { background: Promise<unknown>[] } {
  const background: Promise<unknown>[] = [];
  const interaction = {
    type: 2,
    id: "1",
    application_id: "100000000000000000",
    token: "mod-token",
    version: 1,
    guild_id: G,
    channel: { id: "980000000000000001", type: 0 },
    channel_id: "980000000000000001",
    member: {
      user: { id: MOD, username: "mod", global_name: "Mod", discriminator: "0", avatar: null },
      roles: [],
      permissions: opts.permissions,
    },
    data: {
      id: "2",
      type: 1,
      name,
      options: opts.options ?? [],
      resolved: { users: { [TARGET]: targetUser } },
    },
  } as unknown as APIChatInputApplicationCommandInteraction;
  return { env, interaction, waitUntil: (p) => background.push(p), background };
}

const patchedContents: string[] = [];

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, G, "Mod Guild", null);
  await updateGuildConfig(env.DB, G, { warn_threshold: 2, warn_timeout_minutes: 15 });

  const discord = fetchMock.get("https://discord.com");
  // Deferred-response edits — capture the final message content.
  discord
    .intercept({
      path: /\/api\/v10\/webhooks\/100000000000000000\/mod-token\/messages\/(@|%40)original/,
      method: "PATCH",
      body: (b) => {
        patchedContents.push(String(b));
        return true;
      },
    })
    .reply(200, {})
    .persist();
  discord.intercept({ path: `/api/v10/guilds/${G}/bans/${TARGET}`, method: "PUT" }).reply(204, "").persist();
  discord.intercept({ path: `/api/v10/guilds/${G}/members/${TARGET}`, method: "PATCH" }).reply(200, {}).persist();
  discord.intercept({ path: `/api/v10/guilds/${G}`, method: "GET" }).reply(() => ({ statusCode: 200, data: { owner_id: guildOwnerId } })).persist();
});

describe("moderation built-ins", () => {
  it("refuses members without the permission bit (no defer, ephemeral)", async () => {
    const ctx = makeCtx("ban", { permissions: "0", options: [{ name: "membre", type: 6, value: TARGET }] });
    const res = await banHandler(ctx);
    const body = (await res.json()) as { type: number; data: { flags: number } };
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(ctx.background).toHaveLength(0);
  });

  it("bans via REST, records the mod action, edits the deferred response", async () => {
    const ctx = makeCtx("ban", {
      permissions: "4", // BAN_MEMBERS
      options: [
        { name: "membre", type: 6, value: TARGET },
        { name: "raison", type: 3, value: "raid" },
      ],
    });
    const res = await banHandler(ctx);
    expect(((await res.json()) as { type: number }).type).toBe(5);
    await Promise.all(ctx.background);

    const { rows } = await listModActions(env.DB, G, { page: 1, pageSize: 10, action: "ban" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_id).toBe(TARGET);
    expect(rows[0]?.reason).toBe("raid");
    expect(patchedContents.some((c) => c.includes("banni"))).toBe(true);
  });

  it("warn below the threshold does not auto-timeout; reaching it does", async () => {
    const permissions = (1n << 40n).toString(); // MODERATE_MEMBERS
    const options = [
      { name: "membre", type: 6, value: TARGET },
      { name: "raison", type: 3, value: "spam" },
    ];

    const first = makeCtx("warn", { permissions, options });
    await warnHandler(first);
    await Promise.all(first.background);
    expect(await activeWarningCount(env.DB, G, TARGET)).toBe(1);
    let autoTimeouts = await listModActions(env.DB, G, { page: 1, pageSize: 10, action: "auto_timeout" });
    expect(autoTimeouts.total).toBe(0);

    const second = makeCtx("warn", { permissions, options });
    await warnHandler(second);
    await Promise.all(second.background);
    expect(await activeWarningCount(env.DB, G, TARGET)).toBe(2);
    autoTimeouts = await listModActions(env.DB, G, { page: 1, pageSize: 10, action: "auto_timeout" });
    expect(autoTimeouts.total).toBe(1);
    expect(autoTimeouts.rows[0]?.moderator_id).toBe("system");
    expect(patchedContents.some((c) => c.includes("mute automatique"))).toBe(true);
  });

  it("refuses every slash-command sanction against the guild owner before a mutation", async () => {
    guildOwnerId = TARGET;
    const moderate = (1n << 40n).toString();
    const cases: Array<[string, typeof banHandler, string]> = [
      ["ban", banHandler, "4"],
      ["kick", kickHandler, "2"],
      ["mute", muteHandler, moderate],
      ["warn", warnHandler, moderate],
    ];
    let refusals = 0;
    for (const [name, handler, permissions] of cases) {
      const options: Array<{ name: string; type: number; value: string | number }> = [{ name: "membre", type: 6, value: TARGET }];
      if (name === "mute") options.push({ name: "duree", type: 4, value: 10 });
      const ctx = makeCtx(name, { permissions, options });
      const response = await handler(ctx);
      const body = await response.json() as { type: number; data?: { content?: string; flags?: number } };
      if (body.type === 4 && body.data?.content?.includes("propriétaire du serveur")) refusals++;
      await Promise.all(ctx.background);
    }
    guildOwnerId = "970000000000000099";
    expect(refusals).toBe(4);
  });
});
