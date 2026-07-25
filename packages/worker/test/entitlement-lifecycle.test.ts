import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import {
  CAPABILITY_ENFORCEMENT_MODE,
  EARLY_ACCESS_ORIGIN_REF,
  entitlementLifecycleState,
  isEffectiveEntitlement,
  PLANS,
  resolveOriginKind,
  type CapabilitiesResponse,
  type EntitlementInput,
} from "@bot/shared";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import { createSession } from "../src/auth/session.js";
import { sweepExpiredEntitlements } from "../src/entitlements/sweep.js";
import {
  getEntitlementById,
  insertAssignment,
  insertEntitlement,
  insertGrantWithEntitlement,
} from "../src/db/queries.js";

// Chantier « entitlement-lifecycle-no-payment ». D1/KV roll back between tests →
// each test seeds its own data. Pure helpers are exercised without any DB.

const USER = "730000000000000001";
const NOW = "2026-07-25T12:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";
const FURTHER = "2999-12-31T00:00:00.000Z";

/** Minimal pure input; overridable per case. */
function input(over: Partial<EntitlementInput> = {}): EntitlementInput {
  return {
    planId: "premium",
    source: "granted",
    status: "active",
    startAt: PAST,
    endAt: FUTURE,
    isLifetime: false,
    originRef: null,
    createdAt: PAST,
    ...over,
  };
}

async function session(userId: string): Promise<string> {
  return createSession(env, {
    userId, username: "lc-user", globalName: null, avatar: null,
    accessToken: "tok", refreshToken: "unused", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
}

describe("lifecycle — entitlementLifecycleState (pure, derived)", () => {
  it("active row inside its window → active", () => {
    expect(entitlementLifecycleState(input(), NOW)).toBe("active");
    expect(isEffectiveEntitlement(input(), NOW)).toBe(true);
  });

  it("active row with a future start → scheduled (never stored)", () => {
    const e = input({ startAt: FUTURE, endAt: FURTHER });
    expect(entitlementLifecycleState(e, NOW)).toBe("scheduled");
    expect(isEffectiveEntitlement(e, NOW)).toBe(false);
  });

  it("active row past its end → expired (derived before the sweep runs)", () => {
    const e = input({ startAt: PAST, endAt: PAST });
    expect(entitlementLifecycleState(e, NOW)).toBe("expired");
    expect(isEffectiveEntitlement(e, NOW)).toBe(false);
  });

  it("lifetime active is always active — never expires (null end)", () => {
    const e = input({ isLifetime: true, endAt: null });
    expect(entitlementLifecycleState(e, NOW)).toBe("active");
    expect(entitlementLifecycleState(e, FURTHER)).toBe("active");
  });

  it("stored terminal/explicit statuses take precedence over the window", () => {
    for (const s of ["revoked", "suspended", "cancelled", "past_due", "expired"] as const) {
      // Even with a currently-valid window, the stored status wins.
      expect(entitlementLifecycleState(input({ status: s }), NOW)).toBe(s);
    }
  });

  it("defensive: active non-lifetime with null end, or unparseable start → expired", () => {
    expect(entitlementLifecycleState(input({ isLifetime: false, endAt: null }), NOW)).toBe("expired");
    expect(entitlementLifecycleState(input({ startAt: "not-a-date" }), NOW)).toBe("expired");
  });
});

describe("lifecycle — resolveOriginKind (pure, server-derived, never stored)", () => {
  it("granted + early_access marker → early_access", () => {
    expect(resolveOriginKind("granted", EARLY_ACCESS_ORIGIN_REF)).toBe("early_access");
  });

  it("granted + a plain grant-id ref → granted (standard offered access)", () => {
    expect(resolveOriginKind("granted", "42")).toBe("granted");
    expect(resolveOriginKind("granted", null)).toBe("granted");
  });

  it("other sources pass through unchanged", () => {
    expect(resolveOriginKind("paid", null)).toBe("paid");
    expect(resolveOriginKind("partner", EARLY_ACCESS_ORIGIN_REF)).toBe("partner");
  });
});

describe("lifecycle — sweepExpiredEntitlements (bounded + idempotent)", () => {
  it("expires a passed temporary entitlement, releases its assignment, journals once", async () => {
    const id = await insertEntitlement(env.DB, {
      userId: USER, planId: "premium", source: "granted", endAt: PAST,
    });
    await insertAssignment(env.DB, id, "900000000000000001", "seed");

    const first = await sweepExpiredEntitlements(env);
    expect(first.expired).toBe(1);

    const row = await getEntitlementById(env.DB, id);
    expect(row?.status).toBe("expired");

    // Assignment released (slot freed, row kept): state → suspended, released_at set.
    const asg = await env.DB
      .prepare(`SELECT state, released_at FROM entitlement_guild_assignments WHERE entitlement_id = ?1`)
      .bind(id)
      .first<{ state: string; released_at: string | null }>();
    expect(asg?.state).toBe("suspended");
    expect(asg?.released_at).not.toBeNull();

    // Exactly one 'expire' event journaled.
    const events = await env.DB
      .prepare(`SELECT type, from_status, to_status FROM subscription_events WHERE entitlement_id = ?1`)
      .bind(id)
      .all<{ type: string; from_status: string; to_status: string }>();
    expect(events.results).toEqual([{ type: "expire", from_status: "active", to_status: "expired" }]);

    // Re-run is a no-op (the claim already transitioned the row).
    const second = await sweepExpiredEntitlements(env);
    expect(second.expired).toBe(0);
  });

  it("never expires a lifetime entitlement", async () => {
    const id = await insertEntitlement(env.DB, {
      userId: USER, planId: "business", source: "granted", isLifetime: true,
    });
    const res = await sweepExpiredEntitlements(env);
    expect(res.expired).toBe(0);
    expect((await getEntitlementById(env.DB, id))?.status).toBe("active");
  });

  it("never expires a scheduled (future-start) entitlement", async () => {
    const id = await insertEntitlement(env.DB, {
      userId: USER, planId: "premium", source: "granted", startAt: FUTURE, endAt: FURTHER,
    });
    const res = await sweepExpiredEntitlements(env);
    expect(res.expired).toBe(0);
    expect((await getEntitlementById(env.DB, id))?.status).toBe("active");
  });
});

describe("lifecycle — early access round-trip (OPTION A, no new D1 enum)", () => {
  it("early-access grant stores the marker in origin_ref and derives early_access", async () => {
    const { entitlementId } = await insertGrantWithEntitlement(env.DB, {
      userId: USER, planId: "premium", startAt: PAST, endAt: FUTURE, isLifetime: false,
      durationKind: "30d", grantedBy: "op", reason: "beta", originRef: EARLY_ACCESS_ORIGIN_REF,
    });
    const row = await getEntitlementById(env.DB, entitlementId);
    expect(row?.source).toBe("granted");
    expect(row?.origin_ref).toBe(EARLY_ACCESS_ORIGIN_REF);
    expect(resolveOriginKind("granted", row?.origin_ref ?? null)).toBe("early_access");
  });

  it("standard grant points origin_ref at the grant id → derives granted", async () => {
    const { entitlementId, grantId } = await insertGrantWithEntitlement(env.DB, {
      userId: USER, planId: "premium", startAt: PAST, endAt: FUTURE, isLifetime: false,
      durationKind: "30d", grantedBy: "op", reason: "offered",
    });
    const row = await getEntitlementById(env.DB, entitlementId);
    expect(row?.origin_ref).toBe(String(grantId));
    expect(resolveOriginKind("granted", row?.origin_ref ?? null)).toBe("granted");
  });
});

describe("lifecycle — GET /api/capabilities (read-only, enforcement off, no billing)", () => {
  it("requires a session", async () => {
    const res = await app.request("/api/capabilities", { method: "GET" }, env, createExecutionContext());
    expect(res.status).toBe(401);
  });

  it("returns the plan catalog with guildSlots from PLANS and enforcement off", async () => {
    const sid = await session(USER);
    const res = await app.request(
      "/api/capabilities",
      { method: "GET", headers: { cookie: `session=${sid}` } },
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CapabilitiesResponse;
    expect(body.enforcementMode).toBe(CAPABILITY_ENFORCEMENT_MODE);
    expect(body.enforcementMode).toBe("off");
    expect(body.plans.free.guildSlots).toBe(PLANS.free.slots);
    expect(body.plans.premium.guildSlots).toBe(PLANS.premium.slots);
    expect(body.plans.business.guildSlots).toBe(PLANS.business.slots);
    // Non-slot capacities are deliberately undecided (no enforcement, no billing).
    expect(body.plans.premium.customCommands).toBe("pendingProductDecision");
  });
});
