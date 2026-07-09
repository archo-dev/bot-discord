import { describe, expect, it, beforeAll } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";
import { verifyDiscordSignature } from "../src/interactions/verify.js";
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

async function postInteraction(body: string, headers: Record<string, string>): Promise<Response> {
  const testEnv = { ...(env as unknown as Env), DISCORD_PUBLIC_KEY: publicKeyHex };
  return app.request(
    "/interactions",
    { method: "POST", body, headers: { "content-type": "application/json", ...headers } },
    testEnv,
    createExecutionContext(),
  );
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKeyHex = bytesToHex((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
});

describe("verifyDiscordSignature", () => {
  it("accepts a valid signature", async () => {
    const ts = "1720000000";
    const body = JSON.stringify({ type: 1 });
    const sig = await sign(ts, body);
    expect(await verifyDiscordSignature(publicKeyHex, sig, ts, body)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const ts = "1720000000";
    const sig = await sign(ts, JSON.stringify({ type: 1 }));
    expect(await verifyDiscordSignature(publicKeyHex, sig, ts, JSON.stringify({ type: 2 }))).toBe(false);
  });

  it("rejects a tampered timestamp", async () => {
    const body = JSON.stringify({ type: 1 });
    const sig = await sign("1720000000", body);
    expect(await verifyDiscordSignature(publicKeyHex, sig, "1720000001", body)).toBe(false);
  });

  it("rejects malformed hex inputs without throwing", async () => {
    expect(await verifyDiscordSignature("zz", "00", "0", "{}")).toBe(false);
    expect(await verifyDiscordSignature(publicKeyHex, "abc", "0", "{}")).toBe(false);
    expect(await verifyDiscordSignature("", "", "0", "{}")).toBe(false);
  });
});

describe("POST /interactions", () => {
  it("responds PONG to a signed PING", async () => {
    const body = JSON.stringify({ type: 1 });
    const ts = "1720000000";
    const res = await postInteraction(body, {
      "x-signature-ed25519": await sign(ts, body),
      "x-signature-timestamp": ts,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it("rejects a missing signature with 401", async () => {
    const res = await postInteraction(JSON.stringify({ type: 1 }), {});
    expect(res.status).toBe(401);
  });

  it("rejects an invalid signature with 401", async () => {
    const body = JSON.stringify({ type: 1 });
    const res = await postInteraction(body, {
      "x-signature-ed25519": "00".repeat(64),
      "x-signature-timestamp": "1720000000",
    });
    expect(res.status).toBe(401);
  });

  it("answers /ping with a type-4 message", async () => {
    const body = JSON.stringify({
      type: 2,
      application_id: "100000000000000000",
      token: "tok",
      guild_id: "200000000000000000",
      member: {
        user: { id: "300000000000000000", username: "tester" },
        permissions: "8",
        roles: [],
      },
      channel_id: "400000000000000000",
      data: { type: 1, name: "ping", id: "500000000000000000" },
    });
    const ts = "1720000000";
    const res = await postInteraction(body, {
      "x-signature-ed25519": await sign(ts, body),
      "x-signature-timestamp": ts,
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { type: number; data: { content: string } };
    expect(payload.type).toBe(4);
    expect(payload.data.content).toContain("Pong");
  });
});
