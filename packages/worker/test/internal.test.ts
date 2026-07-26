import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";
import { upsertGuild } from "../src/db/queries.js";
import { isAllowedInternalRoute } from "../src/security/internal-auth.js";

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
    const body = (await res.json()) as { warnThreshold: number; autoRoles: string[]; plan: { id: string; slots: number } };
    expect(body.warnThreshold).toBe(3);
    expect(body.autoRoles).toEqual([]);
    // M7: effective plan surfaced to the gateway; Gratuit by default (flag off, no assignment).
    expect(body.plan).toEqual({ id: "free", rank: 1, slots: 1 });
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

// Choke C — la Gateway POST ses métriques shadow ici. La route DOIT être dans
// l'allowlist signée (sinon 404 avant le handler), sans élargir aucune autre
// route ni contourner la validation Zod.
const VALID_METRIC = {
  surface: "gateway",
  capability: "stats.use",
  effectivePlan: "free",
  requiredPlan: "free",
  reason: "allowed_by_plan",
  decision: "allowed",
  count: 1,
};

describe("internal capability-metrics allowlist (isAllowedInternalRoute)", () => {
  it("allows POST /internal/capability-metrics and nothing adjacent", () => {
    expect(isAllowedInternalRoute("POST", "/internal/capability-metrics")).toBe(true);
    // Mauvaise méthode : refusée.
    expect(isAllowedInternalRoute("GET", "/internal/capability-metrics")).toBe(false);
    expect(isAllowedInternalRoute("DELETE", "/internal/capability-metrics")).toBe(false);
    // Chemins voisins : restent hors allowlist (→ 404).
    expect(isAllowedInternalRoute("POST", "/internal/capability-metrics/extra")).toBe(false);
    expect(isAllowedInternalRoute("POST", "/internal/capability-metricss")).toBe(false);
    expect(isAllowedInternalRoute("POST", "/internal/capability-metric")).toBe(false);
  });

  it("leaves other internal routes unchanged", () => {
    expect(isAllowedInternalRoute("POST", `/internal/guilds/${G}/channel-activity`)).toBe(true);
    expect(isAllowedInternalRoute("GET", `/internal/guilds/${G}/config`)).toBe(true);
    expect(isAllowedInternalRoute("POST", "/internal/gateway/heartbeat")).toBe(true);
    expect(isAllowedInternalRoute("POST", "/internal/nope")).toBe(false);
  });
});

describe("internal capability-metrics endpoint", () => {
  it("reaches the handler with the token and accepts a valid payload (no longer 404)", async () => {
    const res = await req(
      "/internal/capability-metrics",
      { method: "POST", body: JSON.stringify({ items: [VALID_METRIC] }) },
      "test-internal-token",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, written: 1 });
  });

  it("rejects a request without a valid credential", async () => {
    // Aucune auth → 401 (route dans l'allowlist mais credential manquant).
    const noAuth = await req("/internal/capability-metrics", {
      method: "POST",
      body: JSON.stringify({ items: [VALID_METRIC] }),
    });
    expect(noAuth.status).toBe(401);
    // Signature présente mais invalide → refusée (401), jamais acceptée.
    const badSig = await app.request(
      "/internal/capability-metrics",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-version": "1", "x-internal-signature": "deadbeef" },
        body: JSON.stringify({ items: [VALID_METRIC] }),
      },
      env,
      createExecutionContext(),
    );
    expect(badSig.status).toBe(401);
  });

  it("stays 404 on the wrong method or an adjacent path", async () => {
    expect((await req("/internal/capability-metrics", {}, "test-internal-token")).status).toBe(404); // GET
    const neighbour = await req(
      "/internal/capability-metrics/extra",
      { method: "POST", body: JSON.stringify({ items: [VALID_METRIC] }) },
      "test-internal-token",
    );
    expect(neighbour.status).toBe(404);
  });

  it("rejects a payload with out-of-enum dimensions (Zod not bypassed)", async () => {
    const badSurface = await req(
      "/internal/capability-metrics",
      { method: "POST", body: JSON.stringify({ items: [{ ...VALID_METRIC, surface: "telepathy" }] }) },
      "test-internal-token",
    );
    expect(badSurface.status).toBe(400);
    const badReason = await req(
      "/internal/capability-metrics",
      { method: "POST", body: JSON.stringify({ items: [{ ...VALID_METRIC, reason: "because" }] }) },
      "test-internal-token",
    );
    expect(badReason.status).toBe(400);
  });
});
