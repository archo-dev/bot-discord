import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import { createStudioSession, markStudioStepUp } from "../src/auth/studio-session.js";
import { hashIpForAudit, maskAuditMetadata, writeStudioAudit } from "../src/security/studio-audit.js";
import { grantStudioOperatorPermission, insertStudioOperator, listAuditEvents } from "../src/db/queries.js";

// M14 audit & hardening. D1/KV roll back between tests; no fetchMock.

const HOST = "studio.archodev.fr";
const OWNER = "730000000000000001";
const OPERATOR = "730000000000000002";
const TARGET = "740000000000000009";

function studioEnv(extra: Partial<Env> = {}): Env {
  return { ...env, PLATFORM_STUDIO: "true", STUDIO_HOST: HOST, STUDIO_OWNER_IDS: OWNER, ...extra } as Env;
}

async function session(e: Env, userId: string, opts: { stepUp?: boolean } = {}): Promise<string> {
  const id = await createStudioSession(e, {
    userId, username: "op", globalName: null, avatar: null,
    tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
  if (opts.stepUp) await markStudioStepUp(e, id);
  return id;
}

function req(url: string, sid: string | null, e: Env, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", `https://${HOST}`);
  if (sid) headers.set("cookie", `studio_session=${sid}`);
  return app.request(url, { ...init, headers }, e, createExecutionContext());
}

function grantBody(extra: Record<string, unknown> = {}) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: TARGET, planId: "premium", durationKind: "30d", reason: "audit test", ...extra }) };
}

describe("M14 audit — masking & ip hashing (pure)", () => {
  it("masks secrets/PII but keeps business context", () => {
    const masked = maskAuditMetadata({ email: "a@b.co", token: "sk_live", reason: "beta", nested: { secret: "x", planId: "premium" } }) as Record<string, unknown>;
    expect(masked.email).toBe("***");
    expect(masked.token).toBe("***");
    expect(masked.reason).toBe("beta");
    expect((masked.nested as Record<string, unknown>).secret).toBe("***");
    expect((masked.nested as Record<string, unknown>).planId).toBe("premium");
  });

  it("hashes the IP (never stores the raw address)", async () => {
    const h = await hashIpForAudit("secret", "203.0.113.7");
    expect(h).not.toBeNull();
    expect(h).not.toContain("203.0.113.7");
    expect(await hashIpForAudit("secret", null)).toBeNull();
  });
});

describe("M14 audit — sensitive mutations emit one immutable row", () => {
  it("writes an audit_events row on grant (actor operator:<id>, masked metadata)", async () => {
    const e = studioEnv();
    const res = await req(`https://${HOST}/studio-api/subscriptions/grant`, await session(e, OWNER), e, grantBody());
    expect(res.status).toBe(201);
    const { rows } = await listAuditEvents(env.DB, { action: "subscriptions.grant", page: 1, pageSize: 10 });
    expect(rows.length).toBe(1);
    expect(rows[0]!.actor).toBe(`operator:${OWNER}`);
    expect(rows[0]!.target_type).toBe("entitlement");
  });

  it("stores masked metadata + an ip_hash, never the raw ip", async () => {
    const e = studioEnv();
    await writeStudioAudit(e, {
      actor: "operator:1", action: "test.action", metadata: { email: "x@y.z", reason: "ok" }, ip: "198.51.100.9",
    });
    const row = await env.DB.prepare(`SELECT metadata_json, ip_hash FROM audit_events WHERE action = 'test.action'`).first<{ metadata_json: string; ip_hash: string }>();
    expect(row?.metadata_json).toContain("***");
    expect(row?.metadata_json).not.toContain("x@y.z");
    expect(row?.ip_hash).toBeTruthy();
    expect(row?.ip_hash).not.toContain("198.51.100.9");
  });
});

describe("M14 audit — append-only (no write/delete route)", () => {
  it("rejects DELETE/PATCH on /studio-api/audit (route does not exist)", async () => {
    const e = studioEnv();
    const sid = await session(e, OWNER);
    expect((await req(`https://${HOST}/studio-api/audit`, sid, e, { method: "DELETE" })).status).toBe(404);
    expect((await req(`https://${HOST}/studio-api/audit`, sid, e, { method: "PATCH" })).status).toBe(404);
  });
});

describe("M14 audit — read gated by audit.read", () => {
  it("403 without audit.read, 200 with it", async () => {
    const e = studioEnv();
    await insertStudioOperator(env.DB, { userId: OPERATOR });
    await grantStudioOperatorPermission(env.DB, OPERATOR, "subscriptions.read");
    const noPerm = await req(`https://${HOST}/studio-api/audit`, await session(e, OPERATOR), e);
    expect(noPerm.status).toBe(403);

    await grantStudioOperatorPermission(env.DB, OPERATOR, "audit.read");
    const ok = await req(`https://${HOST}/studio-api/audit`, await session(e, OPERATOR), e);
    expect(ok.status).toBe(200);
  });
});

describe("M14 hardening — step-up on lifetime", () => {
  it("403 step_up_required without a recent re-auth; 201 with step-up", async () => {
    const e = studioEnv();
    const noStepUp = await req(`https://${HOST}/studio-api/subscriptions/grant-lifetime`, await session(e, OWNER), e, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET, planId: "business", reason: "partner", confirm: "LIFETIME" }),
    });
    expect(noStepUp.status).toBe(403);
    expect(((await noStepUp.json()) as { error: string }).error).toBe("step_up_required");

    const withStepUp = await req(`https://${HOST}/studio-api/subscriptions/grant-lifetime`, await session(e, OWNER, { stepUp: true }), e, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET, planId: "business", reason: "partner", confirm: "LIFETIME" }),
    });
    expect(withStepUp.status).toBe(201);
  });
});

describe("M14 hardening — per-operator rate limit", () => {
  it("429s after the grant limit in the window", async () => {
    const e = studioEnv();
    const sid = await session(e, OWNER);
    let last = 201;
    // Limit is 20/hour for grant; the 21st must be rejected.
    for (let i = 0; i < 21; i++) {
      const res = await req(`https://${HOST}/studio-api/subscriptions/grant`, sid, e, grantBody({ userId: `74000000000000${String(1000 + i)}` }));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe("M14 hardening — kill-switch", () => {
  it("503 on the studio host when STUDIO_KILL_SWITCH is set; client host still 404", async () => {
    const killed = studioEnv({ STUDIO_KILL_SWITCH: "true" });
    const sid = await session(killed, OWNER);
    expect((await req(`https://${HOST}/studio-api/overview`, sid, killed)).status).toBe(503);
    expect((await req(`https://archodev.fr/studio-api/overview`, sid, killed)).status).toBe(404);
  });
});
