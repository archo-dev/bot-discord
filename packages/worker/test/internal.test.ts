import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";
import { upsertGuild } from "../src/db/queries.js";

const G = "990000000000000001";

function req(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        ...init,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      },
      env,
      createExecutionContext(),
    ),
  );
}

describe("internal API (future gateway)", () => {
  it("rejects requests without the bearer token", async () => {
    expect((await req(`/internal/guilds/${G}/config`)).status).toBe(401);
    expect((await req(`/internal/guilds/${G}/config`, {}, "wrong-token")).status).toBe(401);
  });

  it("serves guild config with the token", async () => {
    await upsertGuild(env.DB, G, "Internal Guild", null);
    const res = await req(`/internal/guilds/${G}/config`, {}, "test-internal-token");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warnThreshold: number; autoRoles: string[] };
    expect(body.warnThreshold).toBe(3);
    expect(body.autoRoles).toEqual([]);
  });

  it("stores gateway heartbeats in KV with a TTL", async () => {
    const unauthorized = await req("/internal/gateway/heartbeat", {
      method: "POST",
      body: JSON.stringify({ guildCount: 2, wsPing: 42 }),
    });
    expect(unauthorized.status).toBe(401);

    const bad = await req(
      "/internal/gateway/heartbeat",
      { method: "POST", body: JSON.stringify({ guildCount: -1 }) },
      "test-internal-token",
    );
    expect(bad.status).toBe(400);

    const ok = await req(
      "/internal/gateway/heartbeat",
      {
        method: "POST",
        body: JSON.stringify({
          guildCount: 2,
          wsPing: 42,
          runtime: {
            version: "0.0.1",
            uptimeSeconds: 120,
            memoryRssMb: 128,
            voiceLogQueueDepth: 3,
            channelActivityQueueDepth: 4,
            errorsSinceLastHeartbeat: 1,
          },
        }),
      },
      "test-internal-token",
    );
    expect(ok.status).toBe(200);

    const status = JSON.parse((await env.KV.get("gateway:status"))!) as {
      guildCount: number;
      wsPing: number | null;
      at: number;
      runtime: { memoryRssMb: number; voiceLogQueueDepth: number };
    };
    expect(status.guildCount).toBe(2);
    expect(status.wsPing).toBe(42);
    expect(status.at).toBeGreaterThan(0);
    expect(status.runtime).toMatchObject({ memoryRssMb: 128, voiceLogQueueDepth: 3 });
  });

  it("accepts gateway events and mod actions", async () => {
    await upsertGuild(env.DB, G, "Internal Guild", null);
    const event = await req(
      `/internal/guilds/${G}/events`,
      { method: "POST", body: JSON.stringify({ eventType: "member_join", payload: { userId: "1" } }) },
      "test-internal-token",
    );
    expect(event.status).toBe(201);

    const action = await req(
      `/internal/guilds/${G}/mod-actions`,
      {
        method: "POST",
        body: JSON.stringify({ action: "timeout", targetId: "990000000000000002", moderatorId: "automod", reason: "spam" }),
      },
      "test-internal-token",
    );
    expect(action.status).toBe(201);

    const bad = await req(
      `/internal/guilds/${G}/events`,
      { method: "POST", body: JSON.stringify({ eventType: "not_a_thing", payload: {} }) },
      "test-internal-token",
    );
    expect(bad.status).toBe(400);
  });
});
