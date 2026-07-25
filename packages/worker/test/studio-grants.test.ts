import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { resolveEffectiveEntitlement, resolveGrantWindow } from "@bot/shared";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import { createStudioSession, markStudioStepUp } from "../src/auth/studio-session.js";
import {
  getEntitlementById,
  grantStudioOperatorPermission,
  insertEntitlement,
  insertStudioOperator,
  listAuditEvents,
  listUserEntitlements,
  rowToEntitlementInput,
} from "../src/db/queries.js";

// M13 grants. D1/KV roll back between tests; no fetchMock. Studio is host-gated
// and dev-authed — sessions are minted directly (like the M12 suite).

const HOST = "studio.archodev.fr";
const OWNER = "710000000000000001";
const OPERATOR = "710000000000000002";
const TARGET = "720000000000000009";
const FUTURE = "2999-01-01T00:00:00.000Z";

function studioEnv(extra: Partial<Env> = {}): Env {
  return { ...env, PLATFORM_STUDIO: "true", STUDIO_HOST: HOST, STUDIO_OWNER_IDS: OWNER, ...extra } as Env;
}

async function studioCookie(e: Env, userId: string, opts: { stepUp?: boolean } = {}): Promise<string> {
  const id = await createStudioSession(e, {
    userId, username: "op", globalName: null, avatar: null,
    tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
  // M14: grant-lifetime requires a recent OAuth re-consent (step-up).
  if (opts.stepUp) await markStudioStepUp(e, id);
  return `studio_session=${id}`;
}

function req(url: string, cookie: string | null, e: Env, body?: unknown) {
  const headers = new Headers({ origin: `https://${HOST}` });
  if (cookie) headers.set("cookie", cookie);
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return app.request(url, init, e, createExecutionContext());
}

async function subscriptionEventTypes(entitlementId: number): Promise<string[]> {
  const res = await env.DB.prepare(`SELECT type FROM subscription_events WHERE entitlement_id = ?1 ORDER BY id`).bind(entitlementId).all<{ type: string }>();
  return (res.results ?? []).map((r) => r.type);
}

/** The user's server-side effective plan id (pure resolution over their rows). */
async function effectivePlan(userId: string): Promise<string> {
  const rows = await listUserEntitlements(env.DB, userId);
  return resolveEffectiveEntitlement(rows.map(rowToEntitlementInput), new Date().toISOString()).planId;
}

describe("M13 grants — resolveGrantWindow (pure)", () => {
  it("computes windows deterministically; lifetime has no end", () => {
    const start = "2026-01-01T00:00:00.000Z";
    expect(resolveGrantWindow("7d", start).endAt).toBe("2026-01-08T00:00:00.000Z");
    expect(resolveGrantWindow("30d", start).endAt).toBe("2026-01-31T00:00:00.000Z");
    expect(resolveGrantWindow("3m", start).endAt).toBe("2026-04-01T00:00:00.000Z");
    expect(resolveGrantWindow("1y", start).endAt).toBe("2027-01-01T00:00:00.000Z");
    expect(resolveGrantWindow("lifetime", start)).toEqual({ endAt: null, isLifetime: true });
    expect(() => resolveGrantWindow("custom", start)).toThrow();
  });
});

describe("M13 grants — grant creates a revocable granted entitlement", () => {
  it("grants premium and the effective plan reflects it", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant`, cookie, e, {
      userId: TARGET, planId: "premium", durationKind: "30d", reason: "beta partner",
    });
    expect(res.status).toBe(201);
    const { entitlementId } = (await res.json()) as { entitlementId: number };
    const ent = await getEntitlementById(env.DB, entitlementId);
    expect(ent?.source).toBe("granted");
    expect(ent?.status).toBe("active");
    expect(await subscriptionEventTypes(entitlementId)).toContain("grant");
  });
});

describe("M13 grants — revocation", () => {
  it("revokes a granted entitlement (status=revoked) and records the trail", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const grant = await req(`https://${HOST}/studio-api/subscriptions/grant`, cookie, e, {
      userId: TARGET, planId: "business", durationKind: "7d", reason: "temp access",
    });
    const { entitlementId } = (await grant.json()) as { entitlementId: number };

    const rev = await req(`https://${HOST}/studio-api/subscriptions/${entitlementId}/revoke`, cookie, e, { reason: "done" });
    expect(rev.status).toBe(200);
    expect((await getEntitlementById(env.DB, entitlementId))?.status).toBe("revoked");
    const g = await env.DB.prepare(`SELECT revoked_by, revoke_reason FROM developer_grants WHERE entitlement_id = ?1`).bind(entitlementId).first<{ revoked_by: string; revoke_reason: string }>();
    expect(g?.revoked_by).toBe(OWNER);
    expect(g?.revoke_reason).toBe("done");
    expect(await subscriptionEventTypes(entitlementId)).toContain("revoke_granted");
  });

  it("NEVER revokes a paid entitlement via the grant workflow (409, unchanged)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const paidId = await insertEntitlement(env.DB, {
      userId: TARGET, planId: "premium", source: "paid", status: "active",
      startAt: "2020-01-01T00:00:00.000Z", endAt: FUTURE,
    });
    const rev = await req(`https://${HOST}/studio-api/subscriptions/${paidId}/revoke`, cookie, e, {});
    expect(rev.status).toBe(409);
    expect(((await rev.json()) as { error: string }).error).toBe("cannot_revoke_paid");
    expect((await getEntitlementById(env.DB, paidId))?.status).toBe("active");
  });
});

describe("M13 grants — lifetime guards", () => {
  it("requires the grant_lifetime permission (403 without it)", async () => {
    const e = studioEnv();
    await insertStudioOperator(env.DB, { userId: OPERATOR });
    await grantStudioOperatorPermission(env.DB, OPERATOR, "subscriptions.grant");
    const cookie = await studioCookie(e, OPERATOR);
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant-lifetime`, cookie, e, {
      userId: TARGET, planId: "business", reason: "partner", confirm: "LIFETIME",
    });
    expect(res.status).toBe(403);
  });

  it("requires the explicit LIFETIME confirmation (400 otherwise)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER, { stepUp: true });
    const bad = await req(`https://${HOST}/studio-api/subscriptions/grant-lifetime`, cookie, e, {
      userId: TARGET, planId: "business", reason: "partner", confirm: "yes",
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("confirmation_required");
  });

  it("creates a lifetime grant (is_lifetime=1, end_at NULL) with permission + confirmation", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER, { stepUp: true });
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant-lifetime`, cookie, e, {
      userId: TARGET, planId: "business", reason: "founding partner", confirm: "LIFETIME",
    });
    expect(res.status).toBe(201);
    const { entitlementId } = (await res.json()) as { entitlementId: number };
    const ent = await getEntitlementById(env.DB, entitlementId);
    expect(ent?.is_lifetime).toBe(1);
    expect(ent?.end_at).toBeNull();
    expect(await subscriptionEventTypes(entitlementId)).toContain("grant_lifetime");
  });
});

describe("M13 grants — auto-attribution & permission enforcement", () => {
  it("forbids a NON-OWNER operator from granting to themselves (403), even with the permission", async () => {
    const e = studioEnv();
    await insertStudioOperator(env.DB, { userId: OPERATOR });
    await grantStudioOperatorPermission(env.DB, OPERATOR, "subscriptions.grant");
    const cookie = await studioCookie(e, OPERATOR);
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant`, cookie, e, {
      userId: OPERATOR, planId: "premium", durationKind: "30d", reason: "self",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("self_grant_forbidden");
    // No entitlement created for the non-owner operator.
    expect(await listUserEntitlements(env.DB, OPERATOR)).toHaveLength(0);
  });

  it("forbids granting without subscriptions.grant (403)", async () => {
    const e = studioEnv();
    await insertStudioOperator(env.DB, { userId: OPERATOR });
    await grantStudioOperatorPermission(env.DB, OPERATOR, "subscriptions.read");
    const cookie = await studioCookie(e, OPERATOR);
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant`, cookie, e, {
      userId: TARGET, planId: "premium", durationKind: "30d", reason: "x",
    });
    expect(res.status).toBe(403);
  });
});

describe("owner self-grant exception — non-owner guard intact", () => {
  it("1 · owner grants themselves a temporary access (201, active granted, effective plan reflects it)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant`, cookie, e, {
      userId: OWNER, planId: "business", durationKind: "30d", reason: "owner offered access",
    });
    expect(res.status).toBe(201);
    const { entitlementId } = (await res.json()) as { entitlementId: number };
    const ent = await getEntitlementById(env.DB, entitlementId);
    expect(ent?.user_id).toBe(OWNER);
    expect(ent?.source).toBe("granted");
    expect(ent?.status).toBe("active");
    expect(await effectivePlan(OWNER)).toBe("business");
  });

  it("2 · owner grants themselves a LIFETIME with step-up + confirmation (201, is_lifetime=1, end_at NULL)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER, { stepUp: true });
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant-lifetime`, cookie, e, {
      userId: OWNER, planId: "business", reason: "owner lifetime", confirm: "LIFETIME",
    });
    expect(res.status).toBe(201);
    const { entitlementId } = (await res.json()) as { entitlementId: number };
    const ent = await getEntitlementById(env.DB, entitlementId);
    expect(ent?.user_id).toBe(OWNER);
    expect(ent?.is_lifetime).toBe(1);
    expect(ent?.end_at).toBeNull();
  });

  it("3 · owner lifetime self-grant WITHOUT a recent step-up is refused (403 step_up_required)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER); // no step-up
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant-lifetime`, cookie, e, {
      userId: OWNER, planId: "business", reason: "owner lifetime", confirm: "LIFETIME",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("step_up_required");
    expect(await listUserEntitlements(env.DB, OWNER)).toHaveLength(0);
  });

  it("4 · owner lifetime self-grant without the exact LIFETIME confirmation is refused (400)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER, { stepUp: true });
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant-lifetime`, cookie, e, {
      userId: OWNER, planId: "business", reason: "owner lifetime", confirm: "lifetime",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("confirmation_required");
    expect(await listUserEntitlements(env.DB, OWNER)).toHaveLength(0);
  });

  it("6 · a NON-OWNER with grant + grant_lifetime still cannot self-grant (403 self_grant_forbidden)", async () => {
    const e = studioEnv();
    await insertStudioOperator(env.DB, { userId: OPERATOR });
    await grantStudioOperatorPermission(env.DB, OPERATOR, "subscriptions.grant");
    await grantStudioOperatorPermission(env.DB, OPERATOR, "subscriptions.grant_lifetime");
    const cookie = await studioCookie(e, OPERATOR, { stepUp: true });
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant-lifetime`, cookie, e, {
      userId: OPERATOR, planId: "business", reason: "self", confirm: "LIFETIME",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("self_grant_forbidden");
    expect(await listUserEntitlements(env.DB, OPERATOR)).toHaveLength(0);
  });

  it("7 · owner granting to ANOTHER user is unchanged (audit action stays subscriptions.grant, no self_grant)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant`, cookie, e, {
      userId: TARGET, planId: "premium", durationKind: "30d", reason: "partner",
    });
    expect(res.status).toBe(201);
    expect((await listAuditEvents(env.DB, { action: "subscriptions.grant", page: 1, pageSize: 10 })).total).toBe(1);
    expect((await listAuditEvents(env.DB, { action: "self_grant", page: 1, pageSize: 10 })).total).toBe(0);
  });

  it("9 · owner self-grant with a missing Origin is rejected by CSRF (403 csrf_rejected), before any INSERT", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const res = await app.request(
      `https://${HOST}/studio-api/subscriptions/grant`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" }, // deliberately no Origin
        body: JSON.stringify({ userId: OWNER, planId: "business", durationKind: "30d", reason: "self" }),
      },
      e,
      createExecutionContext(),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("csrf_rejected");
    expect(await listUserEntitlements(env.DB, OWNER)).toHaveLength(0);
  });

  it("10+11 · owner self-grant writes exactly one self_grant audit and one grant row (no double INSERT)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant`, cookie, e, {
      userId: OWNER, planId: "business", durationKind: "30d", reason: "owner self",
    });
    expect(res.status).toBe(201);
    const { entitlementId, grantId } = (await res.json()) as { entitlementId: number; grantId: number };
    const audits = await listAuditEvents(env.DB, { action: "self_grant", page: 1, pageSize: 10 });
    expect(audits.total).toBe(1);
    expect(audits.rows[0]!.actor).toBe(`operator:${OWNER}`);
    expect(audits.rows[0]!.target_type).toBe("entitlement");
    expect(audits.rows[0]!.target_id).toBe(String(entitlementId));
    const meta = JSON.parse(audits.rows[0]!.metadata_json ?? "{}") as Record<string, unknown>;
    expect(meta).toMatchObject({ userId: OWNER, planId: "business", durationKind: "30d", isLifetime: false, isOwner: true, reason: "owner self" });
    // Exactly one entitlement + one grant row — no duplicate INSERT.
    expect(await listUserEntitlements(env.DB, OWNER)).toHaveLength(1);
    const byEnt = await env.DB.prepare(`SELECT COUNT(*) AS n FROM developer_grants WHERE entitlement_id = ?1`).bind(entitlementId).first<{ n: number }>();
    expect(byEnt?.n).toBe(1);
    const byId = await env.DB.prepare(`SELECT COUNT(*) AS n FROM developer_grants WHERE id = ?1`).bind(grantId).first<{ n: number }>();
    expect(byId?.n).toBe(1);
  });

  it("12+13 · owner self-grant is revocable and the effective plan reverts to free", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const grant = await req(`https://${HOST}/studio-api/subscriptions/grant`, cookie, e, {
      userId: OWNER, planId: "business", durationKind: "30d", reason: "owner self",
    });
    const { entitlementId } = (await grant.json()) as { entitlementId: number };
    expect(await effectivePlan(OWNER)).toBe("business");
    const rev = await req(`https://${HOST}/studio-api/subscriptions/${entitlementId}/revoke`, cookie, e, { reason: "cleanup" });
    expect(rev.status).toBe(200);
    expect((await getEntitlementById(env.DB, entitlementId))?.status).toBe("revoked");
    expect(await subscriptionEventTypes(entitlementId)).toContain("revoke_granted");
    expect(await effectivePlan(OWNER)).toBe("free");
  });

  it("14 · the self-grant flow never touches billing (granted source, no provider call)", async () => {
    // studioEnv leaves PLATFORM_BILLING unset (off); no fetchMock is armed, so any
    // outbound Stripe call would throw — a clean 201 proves billing stays out of the flow.
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant`, cookie, e, {
      userId: OWNER, planId: "business", durationKind: "30d", reason: "owner self",
    });
    expect(res.status).toBe(201);
    const { entitlementId } = (await res.json()) as { entitlementId: number };
    expect((await getEntitlementById(env.DB, entitlementId))?.source).toBe("granted"); // never 'paid'
  });
});

describe("M13 grants — host isolation preserved", () => {
  it("404s the grant route on the client host", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const res = await req(`https://archodev.fr/studio-api/subscriptions/grant`, cookie, e, {
      userId: TARGET, planId: "premium", durationKind: "30d", reason: "x",
    });
    expect(res.status).toBe(404);
  });
});
