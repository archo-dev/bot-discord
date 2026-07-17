import { beforeAll, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock } from "cloudflare:test";
import type { GuildPrivacyResponse, ProductMetricsResponse } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { purgeProductAnalytics, upsertGuild } from "../src/db/queries.js";
import { recordProductMetric } from "../src/analytics/service.js";

const GUILD = "946000000000000001";
const OTHER = "946000000000000002";
const MANAGER = "846000000000000001";

async function session(): Promise<string> {
  return createSession(env, {
    userId: MANAGER, username: "privacy-user", globalName: null, avatar: null,
    accessToken: "privacy-token", refreshToken: "unused", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
}

async function call(path: string, sid: string, method = "GET", body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { cookie: `session=${sid}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, createExecutionContext());
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, GUILD, "Privacy", null);
  await upsertGuild(env.DB, OTHER, "Other", null);
  fetchMock.get("https://discord.com").intercept({ path: "/api/v10/users/@me/guilds", method: "GET" }).reply(() => ({
    statusCode: 200,
    data: [{ id: GUILD, name: "Privacy", icon: null, owner: false, permissions: "32" }],
  })).persist();
});

describe("M08 privacy analytics", () => {
  it("accepts only the finite taxonomy and no free property", async () => {
    expect(await recordProductMetric(env, GUILD, {
      event: "feature_result", module: "tickets", step: null, outcome: "success",
    })).toBe(true);
    expect(await recordProductMetric(env, GUILD, {
      event: "feature_result", module: "tickets", step: null, outcome: "success", content: "private message",
    } as never)).toBe(false);
    const row = await env.DB.prepare(`SELECT count FROM product_metric_contributions WHERE event = 'feature_result'`).first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it("aggregates concurrent writes atomically in one bounded bucket", async () => {
    await Promise.all(Array.from({ length: 8 }, () => recordProductMetric(env, GUILD, {
      event: "feature_result", module: "automod", step: null, outcome: "failure",
    })));
    const row = await env.DB.prepare(
      `SELECT count FROM product_metric_contributions WHERE event = 'feature_result' AND module = 'automod'`,
    ).first<{ count: number }>();
    expect(row?.count).toBe(8);
  });

  it("opts out, purges attributable contributions and isolates other guilds", async () => {
    await recordProductMetric(env, GUILD, { event: "guild_installed", module: null, step: null, outcome: "success" });
    await recordProductMetric(env, OTHER, { event: "guild_installed", module: null, step: null, outcome: "success" });
    const sid = await session();
    const response = await call(`/api/guilds/${GUILD}/privacy`, sid, "PATCH", { productAnalyticsEnabled: false });
    expect(response.status).toBe(200);
    expect((await response.json() as GuildPrivacyResponse).productAnalyticsEnabled).toBe(false);
    expect(await recordProductMetric(env, GUILD, { event: "guild_installed", module: null, step: null, outcome: "success" })).toBe(false);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM product_metric_contributions`).first<{ n: number }>())?.n).toBe(1);
  });

  it("keeps PII/content columns out of metric storage", async () => {
    for (const table of ["product_metric_contributions", "product_metrics"]) {
      const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(columns.results.map((column) => column.name)).not.toEqual(expect.arrayContaining([
        "guild_id", "user_id", "username", "channel_id", "message", "content", "ip_address",
      ]));
    }
  });

  it("limits feedback content and keeps it separate", async () => {
    const sid = await session();
    expect((await call(`/api/guilds/${GUILD}/feedback`, sid, "POST", { category: "idea", message: "Un mode plus simple" })).status).toBe(201);
    expect((await call(`/api/guilds/${GUILD}/feedback`, sid, "POST", { category: "idea", message: "x".repeat(1001) })).status).toBe(400);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM product_feedback`).first<{ n: number }>())?.n).toBe(1);
  });

  it("protects the internal view and applies k-anonymity", async () => {
    expect((await app.request("/internal/product-metrics", {}, env, createExecutionContext())).status).toBe(401);
    const insert = (key: string) => env.DB.prepare(
      `INSERT INTO product_metric_contributions
       (day,guild_key,event,module,step,outcome,app_version,cohort_bucket,count)
       VALUES (date('now'),?1,'guild_installed','','','success','test',0,1)`,
    ).bind(key).run();
    await insert("one"); await insert("two");
    let response = await app.request("/internal/product-metrics", { headers: { authorization: "Bearer test-internal-token" } }, env, createExecutionContext());
    expect((await response.json() as ProductMetricsResponse).metrics).toHaveLength(0);
    await insert("three");
    response = await app.request("/internal/product-metrics", { headers: { authorization: "Bearer test-internal-token" } }, env, createExecutionContext());
    const body = await response.json() as ProductMetricsResponse;
    expect(body.privacyThreshold).toBe(3);
    expect(body.metrics[0]?.guildCount).toBe(3);
  });

  it("aggregates and purges each retention class", async () => {
    await env.DB.prepare(
      `INSERT INTO product_metric_contributions
       (day,guild_key,event,module,step,outcome,app_version,cohort_bucket,count,created_at)
       VALUES (date('now','-8 days'),'old-key','guild_installed','','','success','test',0,2,datetime('now','-8 days'))`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO product_metrics
       (day,event,module,step,outcome,app_version,cohort_bucket,count,guild_count)
       VALUES (date('now','-181 days'),'guild_installed','','','success','test',0,1,1)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO product_feedback (guild_id,category,message,created_at)
       VALUES (?1,'other','expired',datetime('now','-61 days'))`,
    ).bind(GUILD).run();

    const purged = await purgeProductAnalytics(env.DB);
    expect(purged.contributions).toBe(1);
    expect(purged.metrics).toBe(1);
    expect(purged.feedback).toBe(1);
    expect((await env.DB.prepare(`SELECT count FROM product_metrics WHERE day = date('now','-8 days')`).first<{ count: number }>())?.count).toBe(2);
  });
});
