import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { resolveRollout } from "@bot/shared";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import { createStudioSession } from "../src/auth/studio-session.js";
import { resolveGuildFlag } from "../src/config/rollout.js";
import {
  aggregateMetricsForStudio,
  getRollout,
  grantStudioOperatorPermission,
  insertStudioOperator,
  recordOperationMetric,
  setRollout,
  topErrorsForStudio,
} from "../src/db/queries.js";

const HOST = "studio.archodev.fr";
const OWNER = "760000000000000001";
const OPERATOR = "760000000000000002";
const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";

function studioEnv(extra: Partial<Env> = {}): Env {
  return { ...env, PLATFORM_STUDIO: "true", STUDIO_HOST: HOST, STUDIO_OWNER_IDS: OWNER, ...extra } as Env;
}

async function cookie(e: Env, userId: string): Promise<string> {
  const id = await createStudioSession(e, {
    userId, username: "op", globalName: null, avatar: null,
    tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
  return `studio_session=${id}`;
}

function req(url: string, ck: string | null, e: Env, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", `https://${HOST}`);
  if (ck) headers.set("cookie", ck);
  return app.request(url, { ...init, headers }, e, createExecutionContext());
}

describe("M15 — resolveRollout (pure)", () => {
  it("global on ⇒ true; else only cohort guilds", () => {
    expect(resolveRollout({ globalOn: true, cohortGuilds: [], guildId: GUILD_A })).toBe(true);
    expect(resolveRollout({ globalOn: false, cohortGuilds: [GUILD_A], guildId: GUILD_A })).toBe(true);
    expect(resolveRollout({ globalOn: false, cohortGuilds: [GUILD_A], guildId: GUILD_B })).toBe(false);
    expect(resolveRollout({ globalOn: false, cohortGuilds: [], guildId: null })).toBe(false);
  });
});

describe("M15 — metrics aggregation (cross-guild, no PII)", () => {
  it("sums operation_metrics across guild keys per module", async () => {
    await recordOperationMetric(env.DB, { guildKey: "gk_a", module: "moderation", operation: "write", outcome: "success", durationMs: 50, weight: 4 });
    await recordOperationMetric(env.DB, { guildKey: "gk_b", module: "moderation", operation: "write", outcome: "error", durationMs: 900, weight: 1 });
    await recordOperationMetric(env.DB, { guildKey: "gk_a", module: "music", operation: "read", outcome: "success", durationMs: 30, weight: 4 });

    const rows = await aggregateMetricsForStudio(env.DB, 24);
    const mod = rows.find((r) => r.module === "moderation");
    expect(mod).toBeDefined();
    expect(mod!.events).toBe(5); // 4 + 1
    expect(mod!.errors).toBe(1);

    const errs = await topErrorsForStudio(env.DB, 24, 10);
    expect(errs.some((e) => e.module === "moderation" && e.operation === "write")).toBe(true);
    // No raw guild id anywhere in the aggregated output.
    expect(JSON.stringify(rows)).not.toContain(GUILD_A);
  });
});

describe("M15 — /status (public, no session)", () => {
  it("reports component health without PII", async () => {
    const res = await app.request("https://archodev.fr/status", {}, env as Env, createExecutionContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; components: { name: string; status: string }[] };
    expect(body.components.find((c) => c.name === "worker")?.status).toBe("up");
    expect(body.components.find((c) => c.name === "d1")?.status).toBe("up");
    // No gateway heartbeat seeded ⇒ down; overall reflects it.
    expect(body.components.some((c) => c.name === "gateway")).toBe(true);
  });
});

describe("M15 — cohort rollout store + opt-in resolver", () => {
  it("persists a cohort and resolveGuildFlag honours it without touching global flags", async () => {
    await setRollout(env.KV, "platform.entitlements", { global: false, guilds: [GUILD_A] });
    const state = await getRollout(env.KV, "platform.entitlements");
    expect(state.guilds).toContain(GUILD_A);

    // Global env flag off, but the guild is in the KV cohort ⇒ true (opt-in).
    expect(await resolveGuildFlag(env as Env, env.KV, "platform.entitlements", GUILD_A)).toBe(true);
    expect(await resolveGuildFlag(env as Env, env.KV, "platform.entitlements", GUILD_B)).toBe(false);
  });

  it("PUT /studio-api/rollout/:flag writes an audit row and validates snowflakes", async () => {
    const e = studioEnv();
    const ck = await cookie(e, OWNER);
    const res = await req(`https://${HOST}/studio-api/rollout/platform.support`, ck, e, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ global: false, guilds: [GUILD_A, "not-a-snowflake"] }),
    });
    expect(res.status).toBe(400); // invalid snowflake rejected by schema
    const ok = await req(`https://${HOST}/studio-api/rollout/platform.support`, ck, e, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ global: false, guilds: [GUILD_A] }),
    });
    expect(ok.status).toBe(200);
    const audit = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE action='features.manage' AND target_type='rollout'`).first<{ n: number }>();
    expect(audit?.n).toBeGreaterThanOrEqual(1);
  });
});

describe("M15 — permissions & isolation", () => {
  it("403s /metrics without deployments.read; 403s PUT rollout without features.manage", async () => {
    const e = studioEnv();
    await insertStudioOperator(env.DB, { userId: OPERATOR });
    await grantStudioOperatorPermission(env.DB, OPERATOR, "subscriptions.read");
    const ck = await cookie(e, OPERATOR);
    expect((await req(`https://${HOST}/studio-api/metrics`, ck, e)).status).toBe(403);
    const put = await req(`https://${HOST}/studio-api/rollout/platform.support`, ck, e, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ global: false, guilds: [] }),
    });
    expect(put.status).toBe(403);
  });

  it("404s studio observability routes on the client host", async () => {
    const e = studioEnv();
    const ck = await cookie(e, OWNER);
    expect((await req(`https://archodev.fr/studio-api/metrics`, ck, e)).status).toBe(404);
  });
});
