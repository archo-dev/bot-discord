import { describe, expect, it } from "vitest";
import {
  computeRetryDelayMs,
  isIdempotentMethod,
  isRetryableStatus,
  sendWithRetry,
} from "../src/discord/rest.js";

/*
 * Politique de retry Discord (M04). Coeur borné/idempotent testé sans réseau :
 * fetch et sleep sont injectés. Règle : seuls GET/HEAD sont retentés (429/5xx),
 * jamais une mutation, même sur 429.
 */

/** File de réponses/erreurs, comptant les appels et les délais de sommeil. */
function fakeTransport(steps: Array<Response | Error>) {
  let i = 0;
  const delays: number[] = [];
  const fetchImpl = (async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof fetch;
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { fetchImpl, sleep, calls: () => i, delays };
}

const res = (status: number, headers?: Record<string, string>) => new Response(null, { status, headers });

describe("discord retry — pure helpers", () => {
  it("treats only GET/HEAD as idempotent", () => {
    expect(isIdempotentMethod("GET")).toBe(true);
    expect(isIdempotentMethod("head")).toBe(true);
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) expect(isIdempotentMethod(m)).toBe(false);
  });

  it("retries 429 and transient 5xx only", () => {
    for (const s of [429, 500, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [200, 201, 204, 400, 401, 403, 404]) expect(isRetryableStatus(s)).toBe(false);
  });

  it("honours Retry-After, backs off exponentially, and caps the delay", () => {
    expect(computeRetryDelayMs(0, null, 0)).toBe(500); // base backoff
    expect(computeRetryDelayMs(1, null, 0)).toBe(1000); // exponential
    expect(computeRetryDelayMs(0, "3", 0)).toBe(3000); // Retry-After wins when larger
    expect(computeRetryDelayMs(0, "999", 0)).toBe(5000); // capped
    const jittered = computeRetryDelayMs(0, null, 1);
    expect(jittered).toBeGreaterThan(500);
    expect(jittered).toBeLessThanOrEqual(750);
  });
});

describe("discord retry — loop", () => {
  it("retries an idempotent GET on 503 then returns the success", async () => {
    const t = fakeTransport([res(503), res(200)]);
    const out = await sendWithRetry(t.fetchImpl, "https://x/y", { method: "GET" }, "GET", t.sleep);
    expect(out.status).toBe(200);
    expect(t.calls()).toBe(2);
  });

  it("uses Retry-After on a 429 GET", async () => {
    const t = fakeTransport([res(429, { "retry-after": "2" }), res(200)]);
    const out = await sendWithRetry(t.fetchImpl, "https://x/y", { method: "GET" }, "GET", t.sleep);
    expect(out.status).toBe(200);
    expect(t.delays[0]).toBeGreaterThanOrEqual(2000);
  });

  it("stops an idempotent GET after the bounded attempt count", async () => {
    const t = fakeTransport([res(503)]);
    const out = await sendWithRetry(t.fetchImpl, "https://x/y", { method: "GET" }, "GET", t.sleep);
    expect(out.status).toBe(503);
    expect(t.calls()).toBe(3); // 1 initial + 2 retries
  });

  it("NEVER retries a mutation, even on 429", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const t = fakeTransport([res(429, { "retry-after": "1" }), res(200)]);
      const out = await sendWithRetry(t.fetchImpl, "https://x/y", { method }, method, t.sleep);
      expect(out.status).toBe(429);
      expect(t.calls()).toBe(1);
    }
  });

  it("does not retry a mutation on 5xx", async () => {
    const t = fakeTransport([res(503), res(200)]);
    const out = await sendWithRetry(t.fetchImpl, "https://x/y", { method: "POST" }, "POST", t.sleep);
    expect(out.status).toBe(503);
    expect(t.calls()).toBe(1);
  });

  it("retries an idempotent GET on a transport error, then throws if it persists", async () => {
    const ok = fakeTransport([new Error("boom"), res(200)]);
    expect((await sendWithRetry(ok.fetchImpl, "https://x/y", { method: "GET" }, "GET", ok.sleep)).status).toBe(200);
    expect(ok.calls()).toBe(2);

    const dead = fakeTransport([new Error("boom")]);
    await expect(sendWithRetry(dead.fetchImpl, "https://x/y", { method: "GET" }, "GET", dead.sleep)).rejects.toThrow("boom");
    expect(dead.calls()).toBe(3);
  });

  it("does not retry a mutation on a transport error", async () => {
    const t = fakeTransport([new Error("boom"), res(200)]);
    await expect(sendWithRetry(t.fetchImpl, "https://x/y", { method: "POST" }, "POST", t.sleep)).rejects.toThrow("boom");
    expect(t.calls()).toBe(1);
  });
});
