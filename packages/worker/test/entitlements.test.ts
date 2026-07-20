import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import type { Env } from "../src/env.js";
import type { SubscriptionResponse } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { buildSubscriptionResponse } from "../src/api/subscription.js";
import { getWorkerFlags } from "../src/config/flags.js";
import { insertEntitlement, listPlans } from "../src/db/queries.js";

// D1/KV roll back between tests → each test seeds its own data. No fetchMock:
// /api/subscription only reads D1 (no Discord REST).

const USER = "700000000000000001";
const OTHER = "700000000000000002";
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

async function session(userId: string): Promise<string> {
  return createSession(env, {
    userId, username: "sub-user", globalName: null, avatar: null,
    accessToken: "tok", refreshToken: "unused", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
}

describe("M6 entitlements — plan catalog", () => {
  it("seeds the three plans with correct ranks and slots", async () => {
    const plans = await listPlans(env.DB);
    expect(plans.map((p) => p.id)).toEqual(["free", "premium", "business"]);
    expect(plans.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(plans.map((p) => p.slots)).toEqual([1, 3, 5]);
  });
});

describe("M6 entitlements — resolution service", () => {
  it("flag OFF → Gratuit even when the user has a business entitlement", async () => {
    await insertEntitlement(env.DB, { userId: USER, planId: "business", source: "granted", endAt: FUTURE });
    const r = await buildSubscriptionResponse(env.DB, USER, false);
    expect(r.planId).toBe("free");
    expect(r.source).toBeNull();
    expect(r.entitlementsEnabled).toBe(false);
  });

  it("flag ON, no entitlement → Gratuit", async () => {
    const r = await buildSubscriptionResponse(env.DB, USER, true);
    expect(r.planId).toBe("free");
    expect(r.entitlementsEnabled).toBe(true);
  });

  it("flag ON, active granted premium → Premium", async () => {
    await insertEntitlement(env.DB, { userId: USER, planId: "premium", source: "granted", endAt: FUTURE });
    const r = await buildSubscriptionResponse(env.DB, USER, true);
    expect(r.planId).toBe("premium");
    expect(r.slots).toBe(3);
    expect(r.source).toBe("granted");
  });

  it("flag ON, cumul paid Premium + granted Business → Business (5 slots)", async () => {
    await insertEntitlement(env.DB, { userId: USER, planId: "premium", source: "paid", endAt: FUTURE });
    await insertEntitlement(env.DB, { userId: USER, planId: "business", source: "granted", endAt: FUTURE });
    const r = await buildSubscriptionResponse(env.DB, USER, true);
    expect(r.planId).toBe("business");
    expect(r.slots).toBe(5);
  });

  it("ignores other users' entitlements (isolation)", async () => {
    await insertEntitlement(env.DB, { userId: OTHER, planId: "business", source: "granted", endAt: FUTURE });
    const r = await buildSubscriptionResponse(env.DB, USER, true);
    expect(r.planId).toBe("free");
  });

  it("ignores expired and not-yet-started entitlements", async () => {
    await insertEntitlement(env.DB, { userId: USER, planId: "business", source: "granted", endAt: PAST });
    await insertEntitlement(env.DB, { userId: USER, planId: "business", source: "granted", startAt: FUTURE, endAt: "2999-12-31T00:00:00.000Z" });
    const r = await buildSubscriptionResponse(env.DB, USER, true);
    expect(r.planId).toBe("free");
  });

  it("supports a lifetime entitlement (no end_at)", async () => {
    await insertEntitlement(env.DB, { userId: USER, planId: "business", source: "granted", isLifetime: true });
    const r = await buildSubscriptionResponse(env.DB, USER, true);
    expect(r.planId).toBe("business");
    expect(r.isLifetime).toBe(true);
    expect(r.endAt).toBeNull();
  });
});

describe("M6 entitlements — GET /api/subscription", () => {
  it("requires a session", async () => {
    const res = await app.request("/api/subscription", { method: "GET" }, env, createExecutionContext());
    expect(res.status).toBe(401);
  });

  it("returns the effective plan for the session user (flag off default → Gratuit)", async () => {
    const sid = await session(USER);
    const res = await app.request(
      "/api/subscription",
      { method: "GET", headers: { cookie: `session=${sid}` } },
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SubscriptionResponse;
    expect(body.planId).toBe("free");
    expect(body.entitlementsEnabled).toBe(false);
    // No internal origin fields leak into the response shape.
    expect(Object.keys(body).sort()).toEqual(
      ["displayName", "endAt", "entitlementsEnabled", "isLifetime", "planId", "planRank", "slots", "source", "status"].sort(),
    );
  });
});

describe("M6 entitlements — worker flag source", () => {
  it("defaults off, reads PLATFORM_ENTITLEMENTS='true', ignores invalid", () => {
    expect(getWorkerFlags({} as Env)["platform.entitlements"]).toBe(false);
    expect(getWorkerFlags({ PLATFORM_ENTITLEMENTS: "true" } as Env)["platform.entitlements"]).toBe(true);
    expect(getWorkerFlags({ PLATFORM_ENTITLEMENTS: "yes" } as Env)["platform.entitlements"]).toBe(false);
  });
});
