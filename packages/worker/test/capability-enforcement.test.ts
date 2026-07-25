import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../src/env.js";
import { resolveGuildCapabilityContext, checkCapability } from "../src/enforcement/service.js";
import { assignGuild, releaseGuild } from "../src/api/assignments.js";
import {
  aggregateCapabilityShadow,
  incrementCapabilityMetricsBatch,
  insertAssignment,
  insertEntitlement,
} from "../src/db/queries.js";

/* Enforcement des plans (chantier « plan-capability-enforcement »). Résolution
 * GUILDE + métriques shadow sur D1 réel (vitest-pool-workers, rollback entre
 * tests → chaque test seede ses données). Le plan est TOUJOURS résolu côté
 * serveur ; jamais depuis le client. */

const USER = "800000000000000101";
const NOW = new Date("2026-06-01T00:00:00.000Z");
const PAST = "2020-01-01T00:00:00.000Z";
const FAR_PAST_END = "2021-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";
const FAR_FUTURE_START = "2998-01-01T00:00:00.000Z";
const G = (n: number) => `9200000000000000${String(n).padStart(2, "0")}`;

function envMode(mode: string): Env {
  return { ...env, CAPABILITY_ENFORCEMENT_MODE: mode, PLATFORM_ENTITLEMENTS: "true" } as Env;
}

async function ent(overrides: Parameters<typeof insertEntitlement>[1]): Promise<number> {
  return insertEntitlement(env.DB, overrides);
}

describe("résolution du plan effectif par guilde", () => {
  it("1 — Free sans entitlement", async () => {
    const ctx = await resolveGuildCapabilityContext(env.DB, G(1), true, NOW);
    expect(ctx.effectivePlan).toBe("free");
    expect(ctx.freeReason).toBe("assignment_required");
  });

  it("entitlements OFF → Free", async () => {
    const ctx = await resolveGuildCapabilityContext(env.DB, G(1), false, NOW);
    expect(ctx.effectivePlan).toBe("free");
  });

  it("2/9 — Premium actif assigné (lifetime)", async () => {
    const id = await ent({ userId: USER, planId: "premium", source: "granted", status: "active", startAt: PAST, isLifetime: true });
    await insertAssignment(env.DB, id, G(2), USER, PAST);
    const ctx = await resolveGuildCapabilityContext(env.DB, G(2), true, NOW);
    expect(ctx.effectivePlan).toBe("premium");
    expect(ctx.freeReason).toBeNull();
  });

  it("3 — Business actif assigné", async () => {
    const id = await ent({ userId: USER, planId: "business", source: "granted", status: "active", startAt: PAST, endAt: FUTURE });
    await insertAssignment(env.DB, id, G(3), USER, PAST);
    expect((await resolveGuildCapabilityContext(env.DB, G(3), true, NOW)).effectivePlan).toBe("business");
  });

  it("4 — guilde non assignée → Free même si le propriétaire a Business", async () => {
    await ent({ userId: USER, planId: "business", source: "granted", status: "active", startAt: PAST, endAt: FUTURE });
    const ctx = await resolveGuildCapabilityContext(env.DB, G(4), true, NOW);
    expect(ctx.effectivePlan).toBe("free");
    expect(ctx.freeReason).toBe("assignment_required");
  });

  it("5 — assignment libéré → Free", async () => {
    const id = await ent({ userId: USER, planId: "premium", source: "granted", status: "active", startAt: PAST, endAt: FUTURE });
    await insertAssignment(env.DB, id, G(5), USER, PAST);
    await releaseGuild(env.DB, USER, G(5), NOW);
    const ctx = await resolveGuildCapabilityContext(env.DB, G(5), true, NOW);
    expect(ctx.effectivePlan).toBe("free");
    expect(ctx.freeReason).toBe("assignment_required");
  });

  it("6 — entitlement expiré → Free", async () => {
    const id = await ent({ userId: USER, planId: "premium", source: "granted", status: "active", startAt: PAST, endAt: FAR_PAST_END });
    await insertAssignment(env.DB, id, G(6), USER, PAST);
    const ctx = await resolveGuildCapabilityContext(env.DB, G(6), true, NOW);
    expect(ctx.effectivePlan).toBe("free");
    expect(ctx.freeReason).toBe("entitlement_expired");
  });

  it("7 — entitlement révoqué → Free", async () => {
    const id = await ent({ userId: USER, planId: "premium", source: "granted", status: "revoked", startAt: PAST, endAt: FUTURE });
    await insertAssignment(env.DB, id, G(7), USER, PAST);
    const ctx = await resolveGuildCapabilityContext(env.DB, G(7), true, NOW);
    expect(ctx.effectivePlan).toBe("free");
    expect(ctx.freeReason).toBe("entitlement_revoked");
  });

  it("8 — entitlement programmé → Free avant start_at", async () => {
    const id = await ent({ userId: USER, planId: "premium", source: "granted", status: "active", startAt: FAR_FUTURE_START, endAt: FUTURE });
    await insertAssignment(env.DB, id, G(8), USER, PAST);
    const ctx = await resolveGuildCapabilityContext(env.DB, G(8), true, NOW);
    expect(ctx.effectivePlan).toBe("free");
    expect(ctx.freeReason).toBe("entitlement_scheduled");
  });

  it("10 — plusieurs entitlements → meilleur actif assigné", async () => {
    await ent({ userId: USER, planId: "premium", source: "granted", status: "active", startAt: PAST, endAt: FUTURE });
    await ent({ userId: USER, planId: "business", source: "granted", status: "active", startAt: PAST, endAt: FUTURE });
    // assignGuild attache à l'entitlement le mieux classé (business).
    expect((await assignGuild(env.DB, USER, G(10), NOW)).ok).toBe(true);
    expect((await resolveGuildCapabilityContext(env.DB, G(10), true, NOW)).effectivePlan).toBe("business");
  });
});

describe("checkCapability — modes & métriques", () => {
  it("14 — off : autorise et n'écrit AUCUNE métrique", async () => {
    const d = await checkCapability(envMode("off"), { surface: "interaction", guildId: G(1), capability: "music.advanced", now: NOW });
    expect(d.allowed).toBe(true);
    expect(d.wouldBlock).toBe(false);
    expect(await aggregateCapabilityShadow(env.DB, 1)).toHaveLength(0);
  });

  it("15 — shadow : autorise mais compte un would_block (Free × music.advanced)", async () => {
    const d = await checkCapability(envMode("shadow"), { surface: "interaction", guildId: G(1), capability: "music.advanced", now: NOW });
    expect(d.allowed).toBe(true);
    expect(d.wouldBlock).toBe(true);
    const rows = await aggregateCapabilityShadow(env.DB, 1);
    const row = rows.find((r) => r.capability === "music.advanced");
    expect(row).toBeDefined();
    expect(row!.decision).toBe("would_block");
    expect(row!.effective_plan).toBe("free");
    expect(row!.reason).toBe("assignment_required");
    expect(row!.count).toBe(1);
  });

  it("shadow : capability Free comptée comme allowed", async () => {
    await checkCapability(envMode("shadow"), { surface: "api", guildId: G(1), capability: "moderation.use", now: NOW });
    const rows = await aggregateCapabilityShadow(env.DB, 1);
    const row = rows.find((r) => r.capability === "moderation.use");
    expect(row!.decision).toBe("allowed");
  });

  it("16 — enforce : refuse réellement une capability hors plan", async () => {
    const d = await checkCapability(envMode("enforce"), { surface: "interaction", guildId: G(1), capability: "music.advanced", now: NOW });
    expect(d.allowed).toBe(false);
  });

  it("quota : Free au-delà de 5 commandes → would_block en shadow", async () => {
    const d = await checkCapability(envMode("shadow"), { surface: "api", guildId: G(1), capability: "custom_commands.create", usage: 5, now: NOW });
    expect(d.wouldBlock).toBe(true);
    expect(d.reason).toBe("quota_exceeded");
  });

  it("aggregation : deux appels identiques s'agrègent (count=2)", async () => {
    const e = envMode("shadow");
    await checkCapability(e, { surface: "gateway", guildId: G(1), capability: "stats.use", now: NOW });
    await checkCapability(e, { surface: "gateway", guildId: G(1), capability: "stats.use", now: NOW });
    const row = (await aggregateCapabilityShadow(env.DB, 1)).find((r) => r.capability === "stats.use" && r.surface === "gateway");
    expect(row!.count).toBe(2);
  });
});

describe("batch interne (Gateway → Worker) : dims bornées, no PII", () => {
  it("écrit et agrège un lot", async () => {
    await incrementCapabilityMetricsBatch(env.DB, [
      { surface: "gateway", capability: "automod.use", effectivePlan: "free", requiredPlan: "free", reason: "allowed_by_plan", decision: "allowed", count: 3 },
      { surface: "gateway", capability: "music.advanced", effectivePlan: "free", requiredPlan: "premium", reason: "plan_required", decision: "would_block", count: 2 },
    ]);
    const rows = await aggregateCapabilityShadow(env.DB, 1);
    expect(rows.find((r) => r.capability === "automod.use")!.count).toBe(3);
    expect(rows.find((r) => r.capability === "music.advanced")!.decision).toBe("would_block");
  });
});
