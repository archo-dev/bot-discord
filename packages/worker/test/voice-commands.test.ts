import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import { getTempVoiceChannel, insertTempVoiceChannel, upsertGuild } from "../src/db/queries.js";
import type { Env } from "../src/env.js";

const G = "990000000000000020";
const TEMP_CHANNEL = "990000000000000401";
const OWNER = "880000000000000020";
const STRANGER = "880000000000000021";
const CLAIMER = "880000000000000022";
const APP_ID = "100000000000000000";

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let publicKeyHex: string;
let privateKey: CryptoKey;

// userId -> channelId they are currently connected to (missing = not in voice).
const voiceStates = new Map<string, string>();
let capturedWebhook = "";

async function sign(timestamp: string, body: string): Promise<string> {
  const sig = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(timestamp + body));
  return bytesToHex(sig);
}

interface SubOption {
  type: number;
  name: string;
  value: string | number;
}

async function runVoice(invokerId: string, subName: string, options: SubOption[] = [], permissions = "0"): Promise<void> {
  const body = JSON.stringify({
    type: 2,
    application_id: APP_ID,
    token: "tok",
    guild_id: G,
    member: { user: { id: invokerId, username: "u" }, permissions, roles: [] },
    channel_id: "400000000000000000",
    data: { type: 1, id: "5", name: "voice", options: [{ type: 1, name: subName, options }] },
  });
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
  expect(res.status).toBe(200); // deferred immediately
  await waitOnExecutionContext(ctx); // flush the waitUntil work (webhook edit)
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKeyHex = bytesToHex((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);

  await upsertGuild(env.DB, G, "Voice Guild", null);
  await insertTempVoiceChannel(env.DB, G, TEMP_CHANNEL, OWNER);

  fetchMock.activate();
  fetchMock.disableNetConnect();
  // ensureGuild background fetch.
  fetchMock
    .get("https://discord.com")
    .intercept({ path: /\/api\/v10\/guilds\/\d+$/, method: "GET" })
    .reply(200, { id: G, name: "Voice Guild", icon: null })
    .persist();
  // Voice-state lookup — dynamic per user id.
  fetchMock
    .get("https://discord.com")
    .intercept({ path: /\/api\/v10\/guilds\/\d+\/voice-states\/\d+$/, method: "GET" })
    .reply(200, (opts) => {
      const uid = /voice-states\/(\d+)/.exec(opts.path)?.[1] ?? "";
      return { channel_id: voiceStates.get(uid) ?? null };
    })
    .persist();
  // Channel edits (rename/limit).
  fetchMock
    .get("https://discord.com")
    .intercept({ path: /\/api\/v10\/channels\/\d+$/, method: "PATCH" })
    .reply(200, {})
    .persist();
  // The deferred interaction response edit — capture its body.
  fetchMock
    .get("https://discord.com")
    .intercept({ path: /\/api\/v10\/webhooks\/\d+\/[^/]+\/messages\/[^/]+$/, method: "PATCH" })
    .reply(200, (opts) => {
      capturedWebhook = typeof opts.body === "string" ? opts.body : String(opts.body);
      return {};
    })
    .persist();
});

beforeEach(() => {
  voiceStates.clear();
  capturedWebhook = "";
});

describe("/voice ownership + control", () => {
  it("lets the owner rename their channel", async () => {
    voiceStates.set(OWNER, TEMP_CHANNEL);
    await runVoice(OWNER, "rename", [{ type: 3, name: "nom", value: "Mon salon" }]);
    expect(capturedWebhook).toContain("renommé");
    expect((await getTempVoiceChannel(env.DB, TEMP_CHANNEL))?.last_renamed_at).not.toBeNull();
  });

  it("refuses when the invoker is not in a temp channel", async () => {
    // OWNER not connected to any voice channel.
    await runVoice(OWNER, "rename", [{ type: 3, name: "nom", value: "X" }]);
    expect(capturedWebhook).toContain("connecté à votre salon");
  });

  it("refuses a non-owner without Manage Channels", async () => {
    voiceStates.set(STRANGER, TEMP_CHANNEL);
    await runVoice(STRANGER, "rename", [{ type: 3, name: "nom", value: "Hack" }]);
    expect(capturedWebhook).toContain("propriétaire");
  });

  it("lets someone claim when the owner is absent", async () => {
    voiceStates.set(CLAIMER, TEMP_CHANNEL); // owner not in the map → absent
    await runVoice(CLAIMER, "claim");
    expect(capturedWebhook).toContain("propriétaire");
    expect((await getTempVoiceChannel(env.DB, TEMP_CHANNEL))?.owner_id).toBe(CLAIMER);
  });

  it("refuses a claim while the owner is still present", async () => {
    voiceStates.set(CLAIMER, TEMP_CHANNEL);
    voiceStates.set(OWNER, TEMP_CHANNEL);
    await runVoice(CLAIMER, "claim");
    expect(capturedWebhook).toContain("toujours présent");
    expect((await getTempVoiceChannel(env.DB, TEMP_CHANNEL))?.owner_id).toBe(OWNER);
  });
});
