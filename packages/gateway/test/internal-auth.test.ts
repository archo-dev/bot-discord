import { describe, expect, it } from "vitest";
import { signInternalRequest, verifyInternalRequest } from "@bot/shared";

const CURRENT = { keyId: "gw-2026-07", masterSecret: "current-test-secret-32-characters" };
const PREVIOUS = { keyId: "gw-2026-06", masterSecret: "previous-test-secret-32-characters" };

async function signed(key = CURRENT, timestamp = 1_000, nonce = "a".repeat(32)): Promise<Headers> {
  return new Headers(await signInternalRequest({
    ...key,
    direction: "gateway-to-worker",
    audience: "worker-internal",
    method: "POST",
    path: "/internal/gateway/heartbeat?b=2&a=1",
    body: "{\"ok\":true}",
    timestamp,
    nonce,
  }));
}

const verify = (headers: Headers, overrides: Partial<Parameters<typeof verifyInternalRequest>[0]> = {}) =>
  verifyInternalRequest({
    headers,
    keys: [CURRENT, PREVIOUS],
    direction: "gateway-to-worker",
    audience: "worker-internal",
    method: "POST",
    path: "/internal/gateway/heartbeat?a=1&b=2",
    body: "{\"ok\":true}",
    nowSeconds: 1_000,
    ...overrides,
  });

describe("M02 internal HMAC protocol", () => {
  it("accepts current and previous independently-derived keys", async () => {
    expect((await verify(await signed(CURRENT))).ok).toBe(true);
    expect((await verify(await signed(PREVIOUS, 1_000, "b".repeat(32)))).ok).toBe(true);
  });

  it("binds method, normalized path, audience and body", async () => {
    const headers = await signed();
    expect((await verify(headers, { method: "GET" })).ok).toBe(false);
    expect((await verify(headers, { path: "/internal/gateway/other?a=1&b=2" })).ok).toBe(false);
    expect((await verify(headers, { audience: "gateway-http" })).ok).toBe(false);
    expect((await verify(headers, { body: "{\"ok\":false}" })).ok).toBe(false);
  });

  it("rejects timestamps outside the short window and unknown key ids", async () => {
    expect((await verify(await signed(CURRENT, 700))).ok).toBe(false);
    const headers = await signed();
    headers.set("x-internal-key-id", "unknown");
    expect((await verify(headers)).ok).toBe(false);
  });
});
