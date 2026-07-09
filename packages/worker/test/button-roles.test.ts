import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import {
  insertButtonRole,
  insertButtonRoleMessage,
  insertModAction,
  insertWarning,
  upsertGuild,
} from "../src/db/queries.js";
import type { Env } from "../src/env.js";

const G = "940000000000000001";
const MEMBER = "941000000000000001";
const TARGET = "942000000000000001";
const ROLE = "943000000000000001";
const CHANNEL = "944000000000000001";

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let publicKeyHex: string;
let privateKey: CryptoKey;
let roleCalls: Array<{ method: string; path: string }> = [];
let editedContent = "";
let publishedMessageBody = "";

async function sign(timestamp: string, body: string): Promise<string> {
  const sig = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(timestamp + body));
  return bytesToHex(sig);
}

async function postInteraction(payload: unknown): Promise<{ res: Response; ctx: ExecutionContext }> {
  const body = JSON.stringify(payload);
  const ts = "1720000000";
  const testEnv = { ...(env as unknown as Env), DISCORD_PUBLIC_KEY: publicKeyHex };
  const ctx = createExecutionContext();
  const res = await app.request(
    "/interactions",
    {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": await sign(ts, body),
        "x-signature-timestamp": ts,
      },
    },
    testEnv,
    ctx,
  );
  return { res, ctx };
}

function brolePayload(customId: string, roles: string[]) {
  return {
    type: 3,
    application_id: "100000000000000000",
    token: "tok-brole",
    guild_id: G,
    channel: { id: CHANNEL, type: 0 },
    member: { user: { id: MEMBER, username: "membre" }, permissions: "0", roles },
    message: { id: "600000000000000001" },
    data: { component_type: 2, custom_id: customId },
  };
}

async function makeSession(userId: string): Promise<string> {
  return createSession(env, {
    userId,
    username: "panel-user",
    globalName: null,
    avatar: null,
    accessToken: `token-${userId}`,
    refreshToken: "r",
    tokenExpiresAt: Date.now() + 3600_000,
    createdAt: Date.now(),
  });
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKeyHex = bytesToHex((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);

  fetchMock.activate();
  fetchMock.disableNetConnect();
  const discord = fetchMock.get("https://discord.com");

  discord
    .intercept({ path: /\/api\/v10\/guilds\/\d+$/, method: "GET" })
    .reply(200, { id: G, name: "Roles Guild", icon: null })
    .persist();
  discord
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: G, name: "Roles Guild", icon: null, owner: false, permissions: "32" }])
    .persist();
  discord
    .intercept({ path: `/api/v10/channels/${CHANNEL}`, method: "GET" })
    .reply(200, { id: CHANNEL, guild_id: G })
    .persist();
  discord
    .intercept({ path: `/api/v10/channels/${CHANNEL}/messages`, method: "POST" })
    .reply((req) => {
      publishedMessageBody = String(req.body ?? "");
      return { statusCode: 200, data: { id: "605000000000000001" } };
    })
    .persist();
  for (const method of ["PUT", "DELETE"] as const) {
    discord
      .intercept({ path: new RegExp(`/api/v10/guilds/${G}/members/\\d+/roles/\\d+`), method })
      .reply((req) => {
        roleCalls.push({ method, path: req.path });
        return { statusCode: 204, data: "" };
      })
      .persist();
  }
  discord
    .intercept({ path: /(@|%40)original/, method: "PATCH" })
    .reply((req) => {
      editedContent = String(req.body ?? "");
      return { statusCode: 200, data: {} };
    })
    .persist();

  await upsertGuild(env.DB, G, "Roles Guild", null);
});

beforeEach(() => {
  roleCalls = [];
  editedContent = "";
  publishedMessageBody = "";
});

describe("button roles", () => {
  it("publishes a role message through the API with brole custom_ids", async () => {
    const sid = await makeSession("810000000000000088");
    const res = await app.request(
      `/api/guilds/${G}/button-roles`,
      {
        method: "POST",
        body: JSON.stringify({
          channelId: CHANNEL,
          title: "Choisissez vos rôles",
          description: null,
          buttons: [
            { roleId: ROLE, label: "Gamer", emoji: "🎮", style: 1 },
            { roleId: "943000000000000002", label: "Annonces", emoji: null, style: 2 },
          ],
        }),
        headers: { cookie: `session=${sid}`, "content-type": "application/json" },
      },
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(201);
    const dto = (await res.json()) as { messageId: string; buttons: Array<{ id: number; roleId: string }> };
    expect(dto.messageId).toBe("605000000000000001");
    expect(dto.buttons).toHaveLength(2);

    const posted = JSON.parse(publishedMessageBody) as {
      components: Array<{ components: Array<{ custom_id: string; label: string }> }>;
    };
    const customIds = posted.components.flatMap((r) => r.components.map((b) => b.custom_id));
    expect(customIds).toEqual(dto.buttons.map((b) => `brole:${b.id}`));
  });

  it("toggles the role on click (add without role, remove with it)", async () => {
    const msgRef = await insertButtonRoleMessage(env.DB, { guildId: G, channelId: CHANNEL, title: "T", description: null });
    const btnId = await insertButtonRole(env.DB, {
      messageRef: msgRef,
      guildId: G,
      roleId: ROLE,
      label: "Gamer",
      emoji: null,
      style: 2,
      position: 0,
    });

    const add = await postInteraction(brolePayload(`brole:${btnId}`, []));
    expect(((await add.res.json()) as { type: number }).type).toBe(5);
    await waitOnExecutionContext(add.ctx);
    expect(roleCalls).toEqual([{ method: "PUT", path: `/api/v10/guilds/${G}/members/${MEMBER}/roles/${ROLE}` }]);
    expect(editedContent).toContain("ajouté");

    roleCalls = [];
    const remove = await postInteraction(brolePayload(`brole:${btnId}`, [ROLE]));
    await waitOnExecutionContext(remove.ctx);
    expect(roleCalls).toEqual([{ method: "DELETE", path: `/api/v10/guilds/${G}/members/${MEMBER}/roles/${ROLE}` }]);
    expect(editedContent).toContain("retiré");
  });

  it("rejects an unknown or foreign brole id", async () => {
    const { res } = await postInteraction(brolePayload("brole:99999", []));
    const payload = (await res.json()) as { type: number; data: { content: string } };
    expect(payload.type).toBe(4);
    expect(payload.data.content).toContain("plus configuré");
  });
});

describe("/history", () => {
  it("summarises a member's moderation record in an embed", async () => {
    await insertModAction(env.DB, { guildId: G, action: "warn", targetId: TARGET, moderatorId: MEMBER, reason: "spam" });
    await insertModAction(env.DB, {
      guildId: G,
      action: "auto_timeout",
      targetId: TARGET,
      moderatorId: "system",
      reason: "seuil",
    });
    await insertWarning(env.DB, G, TARGET, MEMBER, "spam");

    const { res, ctx } = await postInteraction({
      type: 2,
      application_id: "100000000000000000",
      token: "tok-history",
      guild_id: G,
      channel: { id: CHANNEL, type: 0 },
      member: { user: { id: MEMBER, username: "modo" }, permissions: (1n << 40n).toString(), roles: [] },
      data: {
        type: 1,
        name: "history",
        id: "500000000000000009",
        options: [{ name: "membre", type: 6, value: TARGET }],
        resolved: { users: { [TARGET]: { id: TARGET, username: "cible" } } },
      },
    });
    expect(((await res.json()) as { type: number }).type).toBe(5);
    await waitOnExecutionContext(ctx);

    expect(editedContent).toContain("Historique de cible");
    expect(editedContent).toContain("Timeout auto");
    expect(editedContent).toContain("le système");
    expect(editedContent).toContain("1 warn(s) actif(s)");
  });

  it("refuses members without MODERATE_MEMBERS", async () => {
    const { res } = await postInteraction({
      type: 2,
      application_id: "100000000000000000",
      token: "tok",
      guild_id: G,
      channel: { id: CHANNEL, type: 0 },
      member: { user: { id: MEMBER, username: "membre" }, permissions: "0", roles: [] },
      data: {
        type: 1,
        name: "history",
        id: "500000000000000009",
        options: [{ name: "membre", type: 6, value: TARGET }],
        resolved: { users: { [TARGET]: { id: TARGET, username: "cible" } } },
      },
    });
    const payload = (await res.json()) as { type: number; data: { content: string } };
    expect(payload.type).toBe(4);
    expect(payload.data.content).toContain("permission");
  });
});
