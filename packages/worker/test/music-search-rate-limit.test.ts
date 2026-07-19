import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../src/auth/guard.js";
import type { Env } from "../src/env.js";
import { rateLimit } from "../src/ratelimit.js";

function createLimiter(limit = 2) {
  const values = new Map<string, string>();
  const kv = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  } as unknown as KVNamespace;
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    c.set("session", { userId: "test-user" } as never);
    await next();
  });
  app.post("/guilds/:guildId/search", rateLimit({
    name: "music-search-preview",
    limit,
    scope: "user-guild",
    exactRetryAfter: true,
  }), (c) => c.json({ ok: true }));
  const request = (guildId: string) => Promise.resolve(app.request(
    `/guilds/${guildId}/search`,
    { method: "POST" },
    { KV: kv } as Env,
  ));
  return { request, kv };
}

describe("music search local rate limit", () => {
  afterEach(() => vi.useRealTimers());

  it("shares one bounded allowance across tabs but not across guilds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:31:55.000Z"));
    const { request } = createLimiter(2);
    expect((await request("950000000000000001")).status).toBe(200);
    expect((await request("950000000000000001")).status).toBe(200);
    const limited = await request("950000000000000001");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("5");
    expect(await limited.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 5 });
    expect((await request("950000000000000002")).status).toBe(200);
  });

  it("accepts the next search after the fixed window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:31:59.000Z"));
    const { request } = createLimiter(1);
    expect((await request("950000000000000001")).status).toBe(200);
    expect((await request("950000000000000001")).status).toBe(429);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await request("950000000000000001")).status).toBe(200);
  });
});
