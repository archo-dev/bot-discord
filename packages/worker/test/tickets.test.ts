import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import {
  closeTicket,
  getOpenTicketForUser,
  getTicketByChannel,
  insertTicket,
  upsertGuild,
  upsertTicketSettings,
} from "../src/db/queries.js";
import type { Env } from "../src/env.js";

const G = "920000000000000001";
const CREATOR = "921000000000000001";
const STRANGER = "922000000000000001";
const CATEGORY = "707000000000000001";
const TICKET_CHANNEL = "700000000000000001";
const PANEL_CHANNEL = "705000000000000001";
const TRANSCRIPT_CHANNEL = "706000000000000001";

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let publicKeyHex: string;
let privateKey: CryptoKey;
let channelCreateBody = "";
let ticketChannelDeleted = false;
let transcriptUploaded = false;

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

function member(userId: string, permissions = "0", roles: string[] = []) {
  return { user: { id: userId, username: `u${userId.slice(-2)}` }, permissions, roles };
}

function buttonPayload(customId: string, userId: string, channelId: string, permissions = "0") {
  return {
    type: 3,
    application_id: "100000000000000000",
    token: "tok-component",
    guild_id: G,
    channel: { id: channelId, type: 0 },
    member: member(userId, permissions),
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

function apiRequest(path: string, sessionId: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        ...init,
        headers: {
          cookie: `session=${sessionId}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      },
      env,
      createExecutionContext(),
    ),
  );
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKeyHex = bytesToHex((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);

  fetchMock.activate();
  fetchMock.disableNetConnect();
  const discord = fetchMock.get("https://discord.com");

  // ensureGuild + session guard
  discord
    .intercept({ path: /\/api\/v10\/guilds\/\d+$/, method: "GET" })
    .reply(200, { id: G, name: "Ticket Guild", icon: null })
    .persist();
  discord
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: G, name: "Ticket Guild", icon: null, owner: false, permissions: "32" }])
    .persist();

  // Ticket channel lifecycle
  discord
    .intercept({ path: `/api/v10/guilds/${G}/channels`, method: "POST" })
    .reply((req) => {
      channelCreateBody = String(req.body ?? "");
      return { statusCode: 201, data: { id: TICKET_CHANNEL } };
    })
    .persist();
  discord
    .intercept({ path: `/api/v10/channels/${TICKET_CHANNEL}/messages`, method: "POST" })
    .reply(200, { id: "601000000000000001" })
    .persist();
  discord
    .intercept({ path: new RegExp(`/api/v10/channels/${TICKET_CHANNEL}/messages\\?limit=100`), method: "GET" })
    .reply(200, [
      {
        id: "m2",
        content: "deuxième message",
        timestamp: "2026-07-09T10:01:00.000Z",
        author: { id: CREATOR, username: "alice" },
        attachments: [],
        embeds: [],
      },
      {
        id: "m1",
        content: "premier message",
        timestamp: "2026-07-09T10:00:00.000Z",
        author: { id: CREATOR, username: "alice" },
        attachments: [],
        embeds: [],
      },
    ])
    .persist();
  discord
    .intercept({ path: `/api/v10/channels/${TICKET_CHANNEL}`, method: "DELETE" })
    .reply(() => {
      ticketChannelDeleted = true;
      return { statusCode: 200, data: { id: TICKET_CHANNEL } };
    })
    .persist();
  discord
    .intercept({ path: `/api/v10/channels/${TRANSCRIPT_CHANNEL}/messages`, method: "POST" })
    .reply(() => {
      transcriptUploaded = true;
      return { statusCode: 200, data: { id: "602000000000000001" } };
    })
    .persist();

  // Panel publication
  discord
    .intercept({ path: `/api/v10/channels/${PANEL_CHANNEL}`, method: "GET" })
    .reply(200, { id: PANEL_CHANNEL, guild_id: G })
    .persist();
  discord
    .intercept({ path: `/api/v10/channels/${PANEL_CHANNEL}/messages`, method: "POST" })
    .reply(200, { id: "603000000000000001" })
    .persist();

  // Webhook edits of deferred responses (@original is %40original once encoded)
  discord
    .intercept({ path: /(@|%40)original/, method: "PATCH" })
    .reply(200, {})
    .persist();

  await upsertGuild(env.DB, G, "Ticket Guild", null);
  await upsertTicketSettings(env.DB, G, {
    enabled: true,
    categoryId: CATEGORY,
    staffRoleIds: ["930000000000000001"],
    transcriptChannelId: TRANSCRIPT_CHANNEL,
  });
});

// NB: vitest-pool-workers annule les écritures D1/KV après chaque test —
// seuls les seeds du beforeAll persistent. Chaque test est donc autonome.
describe("ticket system", () => {
  it("opens a ticket from the panel button, then refuses a second one", async () => {
    const { res, ctx } = await postInteraction(buttonPayload("ticket:open", CREATOR, PANEL_CHANNEL));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { type: number; data: { flags: number } };
    expect(payload.type).toBe(5); // deferred, ephemeral
    expect(payload.data.flags).toBe(64);
    await waitOnExecutionContext(ctx);

    const ticket = await getOpenTicketForUser(env.DB, G, CREATOR);
    expect(ticket).not.toBeNull();
    expect(ticket!.number).toBe(1);
    expect(ticket!.channel_id).toBe(TICKET_CHANNEL);

    const body = JSON.parse(channelCreateBody) as {
      name: string;
      parent_id: string;
      permission_overwrites: Array<{ id: string }>;
    };
    expect(body.name).toBe("ticket-0001");
    expect(body.parent_id).toBe(CATEGORY);
    const overwriteIds = body.permission_overwrites.map((o) => o.id);
    expect(overwriteIds).toContain(CREATOR);
    expect(overwriteIds).toContain("930000000000000001"); // rôle staff
    expect(overwriteIds).toContain(G); // deny @everyone

    const again = await postInteraction(buttonPayload("ticket:open", CREATOR, PANEL_CHANNEL));
    const refused = (await again.res.json()) as { type: number; data: { content: string } };
    expect(refused.type).toBe(4);
    expect(refused.data.content).toContain("déjà un ticket");
  });

  it("runs the close flow: stranger refused, creator gets the modal, submission closes everything", async () => {
    await insertTicket(env.DB, { guildId: G, number: 7, channelId: TICKET_CHANNEL, userId: CREATOR });

    const stranger = await postInteraction(buttonPayload("ticket:close", STRANGER, TICKET_CHANNEL));
    const strangerPayload = (await stranger.res.json()) as { type: number; data: { content: string } };
    expect(strangerPayload.type).toBe(4);
    expect(strangerPayload.data.content).toContain("créateur");

    const prompt = await postInteraction(buttonPayload("ticket:close", CREATOR, TICKET_CHANNEL));
    const promptPayload = (await prompt.res.json()) as { type: number; data: { custom_id: string } };
    expect(promptPayload.type).toBe(9); // modal
    expect(promptPayload.data.custom_id).toMatch(/^ticket:closec:\d+$/);

    const { res, ctx } = await postInteraction({
      type: 5,
      application_id: "100000000000000000",
      token: "tok-modal",
      guild_id: G,
      member: member(CREATOR),
      data: {
        custom_id: promptPayload.data.custom_id,
        components: [{ type: 1, components: [{ type: 4, custom_id: "reason", value: "problème résolu" }] }],
      },
    });
    expect(((await res.json()) as { type: number }).type).toBe(5);
    await waitOnExecutionContext(ctx);

    const ticket = await getTicketByChannel(env.DB, TICKET_CHANNEL);
    expect(ticket!.status).toBe("closed");
    expect(ticket!.closed_by).toBe(CREATOR);
    expect(ticket!.close_reason).toBe("problème résolu");
    expect(ticket!.transcript).toContain("premier message");
    expect(ticket!.transcript!.indexOf("premier message")).toBeLessThan(ticket!.transcript!.indexOf("deuxième message"));
    expect(transcriptUploaded).toBe(true);
    expect(ticketChannelDeleted).toBe(true);
  });

  it("exposes settings, publication and the ticket list through the panel API", async () => {
    const sid = await makeSession("810000000000000077");

    const put = await apiRequest(`/api/guilds/${G}/tickets/settings`, sid, {
      method: "PUT",
      body: JSON.stringify({
        enabled: true,
        categoryId: CATEGORY,
        staffRoleIds: ["930000000000000001", "930000000000000002"],
        transcriptChannelId: null,
      }),
    });
    expect(put.status).toBe(200);

    const got = (await (await apiRequest(`/api/guilds/${G}/tickets/settings`, sid)).json()) as {
      staffRoleIds: string[];
      transcriptChannelId: string | null;
    };
    expect(got.staffRoleIds).toHaveLength(2);
    expect(got.transcriptChannelId).toBeNull();

    const publish = await apiRequest(`/api/guilds/${G}/tickets/panel`, sid, {
      method: "POST",
      body: JSON.stringify({ channelId: PANEL_CHANNEL, title: "Support", description: "Ouvrez un ticket." }),
    });
    expect(publish.status).toBe(200);

    const id = await insertTicket(env.DB, { guildId: G, number: 9, channelId: TICKET_CHANNEL, userId: CREATOR });
    await closeTicket(env.DB, id, CREATOR, "raison", "contenu du transcript");

    const list = (await (await apiRequest(`/api/guilds/${G}/tickets`, sid)).json()) as {
      items: Array<{ number: number; status: string; hasTranscript: boolean }>;
      total: number;
    };
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ number: 9, status: "closed", hasTranscript: true });

    const transcript = await apiRequest(`/api/guilds/${G}/tickets/${id}/transcript`, sid);
    expect(transcript.status).toBe(200);
  });

  it("rejects an unknown component and a rogue modal id", async () => {
    const unknown = await postInteraction(buttonPayload("nope:nope", CREATOR, PANEL_CHANNEL));
    expect(((await unknown.res.json()) as { type: number }).type).toBe(4);

    const rogue = await postInteraction({
      type: 5,
      application_id: "100000000000000000",
      token: "tok",
      guild_id: G,
      member: member(STRANGER),
      data: { custom_id: "ticket:closec:9999", components: [] },
    });
    const payload = (await rogue.res.json()) as { type: number; data: { content: string } };
    expect(payload.type).toBe(4);
    expect(payload.data.content).toContain("n'existe pas");
  });
});
