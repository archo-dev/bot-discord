import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import type { SubscriptionAssignmentsResponse } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import {
  assignGuild,
  buildAssignmentsResponse,
  releaseGuild,
  resolveGuildPlan,
} from "../src/api/assignments.js";
import { insertAssignment, insertEntitlement } from "../src/db/queries.js";

// D1/KV roll back between tests → each test seeds its own data. No fetchMock: the
// service functions take (db, userId, guildId, now) and never call Discord; the
// manage_guild gate lives at the HTTP layer (covered by api-guard tests).

const USER = "800000000000000001";
const OTHER = "800000000000000002";
const FUTURE = "2999-01-01T00:00:00.000Z";
const G = (n: number) => `9100000000000000${String(n).padStart(2, "0")}`;

async function premium(userId: string): Promise<void> {
  // Explicit past start so simulated `now` values (cooldown test) fall in-window.
  await insertEntitlement(env.DB, {
    userId, planId: "premium", source: "granted", startAt: "2020-01-01T00:00:00.000Z", endAt: FUTURE,
  });
}

describe("M7 slot assignments — service", () => {
  it("flag OFF → Gratuit, no slots", async () => {
    await premium(USER);
    const r = await buildAssignmentsResponse(env.DB, USER, false);
    expect(r.planId).toBe("free");
    expect(r.slots).toBe(0);
    expect(r.entitlementsEnabled).toBe(false);
  });

  it("no active entitlement → cannot assign", async () => {
    const res = await assignGuild(env.DB, USER, G(1), new Date());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("no_active_entitlement");
  });

  it("assign consumes a slot; response reflects used/available", async () => {
    await premium(USER);
    expect((await assignGuild(env.DB, USER, G(1), new Date())).ok).toBe(true);
    const r = await buildAssignmentsResponse(env.DB, USER, true);
    expect(r.planId).toBe("premium");
    expect(r.slots).toBe(3);
    expect(r.used).toBe(1);
    expect(r.available).toBe(2);
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0]!.state).toBe("active");
  });

  it("rejects assigning beyond plan capacity", async () => {
    await premium(USER);
    for (const n of [1, 2, 3]) expect((await assignGuild(env.DB, USER, G(n), new Date())).ok).toBe(true);
    const res = await assignGuild(env.DB, USER, G(4), new Date());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("no_slot_available");
  });

  it("rejects assigning a guild already live-assigned", async () => {
    await premium(USER);
    await assignGuild(env.DB, USER, G(1), new Date());
    const res = await assignGuild(env.DB, USER, G(1), new Date());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("guild_already_assigned");
  });

  it("downgrade suspends the oldest excess (config never deleted), reactivates on upgrade", async () => {
    // Premium (3 slots) but 5 pre-existing assignments (as if downgraded from Business).
    await premium(USER);
    const ent = await env.DB.prepare(`SELECT id FROM entitlements WHERE user_id = ?1`).bind(USER).first<{ id: number }>();
    for (let n = 1; n <= 5; n++) {
      await insertAssignment(env.DB, ent!.id, G(n), USER, `2026-0${n}-01T00:00:00.000Z`);
    }
    const r = await buildAssignmentsResponse(env.DB, USER, true);
    expect(r.used).toBe(3);
    const active = r.assignments.filter((a) => a.state === "active").map((a) => a.guildId).sort();
    const suspended = r.assignments.filter((a) => a.state === "suspended").map((a) => a.guildId).sort();
    expect(active).toEqual([G(3), G(4), G(5)].sort()); // 3 most recent
    expect(suspended).toEqual([G(1), G(2)].sort()); // config kept, just suspended
    // No assignment row was deleted.
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM entitlement_guild_assignments`).first<{ n: number }>();
    expect(count!.n).toBe(5);
  });

  it("release frees the slot and records released_at (config intact)", async () => {
    await premium(USER);
    await assignGuild(env.DB, USER, G(1), new Date());
    const res = await releaseGuild(env.DB, USER, G(1), new Date());
    expect(res.ok).toBe(true);
    const r = await buildAssignmentsResponse(env.DB, USER, true);
    expect(r.used).toBe(0);
    const row = await env.DB.prepare(`SELECT released_at FROM entitlement_guild_assignments WHERE guild_id = ?1`).bind(G(1)).first<{ released_at: string | null }>();
    expect(row!.released_at).not.toBeNull();
  });

  it("cannot release a guild you did not assign (isolation)", async () => {
    await premium(USER);
    await assignGuild(env.DB, USER, G(1), new Date());
    const res = await releaseGuild(env.DB, OTHER, G(1), new Date());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_assigned");
  });

  it("enforces the reassignment cooldown then allows it after the window", async () => {
    await premium(USER);
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    await assignGuild(env.DB, USER, G(1), t0);
    await releaseGuild(env.DB, USER, G(1), t0);
    const soon = new Date(t0.getTime() + 60 * 60 * 1000); // +1h
    const blocked = await assignGuild(env.DB, USER, G(1), soon);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("reassign_cooldown");
    const later = new Date(t0.getTime() + 25 * 60 * 60 * 1000); // +25h
    expect((await assignGuild(env.DB, USER, G(1), later)).ok).toBe(true);
  });

  it("does not see another user's assignments", async () => {
    await premium(OTHER);
    await assignGuild(env.DB, OTHER, G(1), new Date());
    const r = await buildAssignmentsResponse(env.DB, USER, true);
    expect(r.assignments).toHaveLength(0);
    expect(r.used).toBe(0);
  });
});

describe("M7 guild plan resolution (gateway config)", () => {
  it("flag OFF → Gratuit", async () => {
    await premium(USER);
    await assignGuild(env.DB, USER, G(1), new Date());
    expect((await resolveGuildPlan(env.DB, G(1), new Date(), false)).id).toBe("free");
  });

  it("assigned & active → the user's effective plan; unassigned → Gratuit", async () => {
    await premium(USER);
    await assignGuild(env.DB, USER, G(1), new Date());
    expect((await resolveGuildPlan(env.DB, G(1), new Date(), true)).id).toBe("premium");
    expect((await resolveGuildPlan(env.DB, G(2), new Date(), true)).id).toBe("free");
  });

  it("an over-capacity (suspended) guild resolves to Gratuit", async () => {
    await premium(USER);
    const ent = await env.DB.prepare(`SELECT id FROM entitlements WHERE user_id = ?1`).bind(USER).first<{ id: number }>();
    for (let n = 1; n <= 4; n++) {
      await insertAssignment(env.DB, ent!.id, G(n), USER, `2026-0${n}-01T00:00:00.000Z`);
    }
    // G(1) is the oldest → suspended under premium's 3 slots.
    expect((await resolveGuildPlan(env.DB, G(1), new Date(), true)).id).toBe("free");
    expect((await resolveGuildPlan(env.DB, G(4), new Date(), true)).id).toBe("premium");
  });
});

describe("M7 GET /api/subscription/assignments", () => {
  it("requires a session", async () => {
    const res = await app.request("/api/subscription/assignments", { method: "GET" }, env, createExecutionContext());
    expect(res.status).toBe(401);
  });

  it("returns Gratuit/empty with the flag off (default)", async () => {
    const sid = await createSession(env, {
      userId: USER, username: "slot-user", globalName: null, avatar: null,
      accessToken: "tok", refreshToken: "unused", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
    });
    const res = await app.request(
      "/api/subscription/assignments",
      { method: "GET", headers: { cookie: `session=${sid}` } },
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SubscriptionAssignmentsResponse;
    expect(body.planId).toBe("free");
    expect(body.entitlementsEnabled).toBe(false);
    expect(body.assignments).toEqual([]);
  });
});
