import { describe, expect, it, beforeAll } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import app from "../src/index.js";
import { pickGif, SOCIAL_ACTIONS } from "../src/interactions/builtins/social-data.js";
import type { Env } from "../src/env.js";

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let publicKeyHex: string;
let privateKey: CryptoKey;

async function sign(timestamp: string, body: string): Promise<string> {
  const sig = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(timestamp + body));
  return bytesToHex(sig);
}

const AUTHOR_ID = "300000000000000000";
const TARGET_ID = "310000000000000000";

interface TargetOpts {
  bot?: boolean;
}

function interactionBody(name: string, targetId: string, target: TargetOpts = {}): string {
  return JSON.stringify({
    type: 2,
    application_id: "100000000000000000",
    token: "tok",
    guild_id: "200000000000000000",
    member: {
      user: { id: AUTHOR_ID, username: "auteur" },
      permissions: "0",
      roles: [],
    },
    channel_id: "400000000000000000",
    data: {
      type: 1,
      id: "500000000000000000",
      name,
      options: [{ type: 6, name: "membre", value: targetId }],
      resolved: { users: { [targetId]: { id: targetId, username: "cible", bot: target.bot ?? false } } },
    },
  });
}

async function invoke(name: string, targetId: string, target: TargetOpts = {}) {
  const body = interactionBody(name, targetId, target);
  const ts = "1720000000";
  const testEnv = { ...(env as unknown as Env), DISCORD_PUBLIC_KEY: publicKeyHex };
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
    createExecutionContext(),
  );
  return res;
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKeyHex = bytesToHex((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);

  // ensureGuild() fires a background REST GET; stub it so no live network is hit.
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: /\/api\/v10\/guilds\/\d+/, method: "GET" })
    .reply(200, { id: "200000000000000000", name: "Mock Guild", icon: null })
    .persist();
});

describe("social actions", () => {
  it("/kiss on a valid target pings only the target and attaches a GIF", async () => {
    const res = await invoke("kiss", TARGET_ID);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      type: number;
      data: {
        content: string;
        embeds?: Array<{ color: number; image: { url: string } }>;
        flags?: number;
        allowed_mentions: { parse: string[]; users?: string[] };
      };
    };
    expect(payload.type).toBe(4);
    expect(payload.data.content).toContain(`<@${AUTHOR_ID}>`);
    expect(payload.data.content).toContain(`<@${TARGET_ID}>`);
    expect(payload.data.allowed_mentions.users).toEqual([TARGET_ID]);
    expect(payload.data.flags ?? 0).toBe(0); // public, not ephemeral
    expect(payload.data.embeds?.[0]?.color).toBe(SOCIAL_ACTIONS.kiss!.color);
    expect(SOCIAL_ACTIONS.kiss!.gifs).toContain(payload.data.embeds?.[0]?.image.url);
  });

  it("refuses self-hug ephemerally and pings nobody", async () => {
    const res = await invoke("hug", AUTHOR_ID);
    const payload = (await res.json()) as {
      type: number;
      data: { flags?: number; allowed_mentions: { parse: string[]; users?: string[] } };
    };
    expect(payload.type).toBe(4);
    expect(payload.data.flags).toBe(64); // MessageFlags.Ephemeral
    expect(payload.data.allowed_mentions.users).toBeUndefined();
  });

  it("allows self-slap publicly with a GIF", async () => {
    const res = await invoke("slap", AUTHOR_ID);
    const payload = (await res.json()) as {
      data: { flags?: number; embeds?: unknown[]; allowed_mentions: { users?: string[] } };
    };
    expect(payload.data.flags ?? 0).toBe(0);
    expect(payload.data.embeds?.length).toBe(1);
    expect(payload.data.allowed_mentions.users).toEqual([]);
  });

  it("uses the playful bot variant when targeting a bot", async () => {
    const res = await invoke("kiss", "320000000000000000", { bot: true });
    const payload = (await res.json()) as { data: { content: string } };
    expect(payload.data.content).toContain("court-circuite");
  });
});

describe("pickGif", () => {
  it("returns undefined for an empty list (no crash)", () => {
    expect(pickGif([])).toBeUndefined();
  });

  it("returns a member of the list otherwise", () => {
    const gifs = SOCIAL_ACTIONS.pat!.gifs;
    expect(gifs).toContain(pickGif(gifs));
  });
});
