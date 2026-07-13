import { beforeAll, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env, fetchMock } from "cloudflare:test";
import { logTelemetry } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import {
  listHealthMetrics,
  purgeObservabilityMetrics,
  recordOperationMetric,
  replacePanelAccess,
  upsertGuild,
} from "../src/db/queries.js";
import {
  acceptedRequestId,
  classifyRequest,
  metricSampleWeight,
  pseudonymizeGuild,
} from "../src/telemetry/request.js";

const GUILD = "998000000000000001";
const ADMIN = "898000000000000001";
const MODERATOR = "898000000000000002";

async function session(userId: string): Promise<string> {
  return createSession(env, {
    userId,
    username: "private-name-must-not-be-logged",
    globalName: null,
    avatar: null,
    accessToken: `private-access-${userId}`,
    refreshToken: "private-refresh",
    tokenExpiresAt: Date.now() + 3_600_000,
    createdAt: Date.now(),
  });
}

function get(path: string, sessionId: string): Promise<Response> {
  return Promise.resolve(
    app.request(path, { headers: { cookie: `session=${sessionId}` } }, env, createExecutionContext()),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, GUILD, "Observability Guild", null);
  await replacePanelAccess(
    env.DB,
    GUILD,
    [
      { subjectType: "user", subjectId: ADMIN, level: "admin" },
      { subjectType: "user", subjectId: MODERATOR, level: "moderator" },
    ],
    "owner",
  );
  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: GUILD, name: "Observability Guild", icon: null, owner: false, permissions: "0" }])
    .persist();
});

describe("bounded telemetry", () => {
  it("classifies paths into finite dimensions and validates request IDs", () => {
    expect(classifyRequest("GET", `/api/guilds/${GUILD}/stats/members`)).toMatchObject({
      module: "stats",
      operation: "read",
      guildId: GUILD,
    });
    expect(classifyRequest("POST", "/internal/gateway/heartbeat")).toMatchObject({
      module: "gateway",
      operation: "heartbeat",
    });
    expect(classifyRequest("GET", "/assets/private-token.js")).toBeNull();
    expect(acceptedRequestId("valid_request_123")).toBe("valid_request_123");
    expect(acceptedRequestId("bad id")).not.toBe("bad id");
  });

  it("uses deterministic non-raw guild pseudonyms", async () => {
    const first = await pseudonymizeGuild("deployment-secret", GUILD);
    const second = await pseudonymizeGuild("deployment-secret", GUILD);
    expect(first).toBe(second);
    expect(first).toHaveLength(32);
    expect(first).not.toContain(GUILD);
    expect(await pseudonymizeGuild("rotated-secret", GUILD)).not.toBe(first);
  });

  it("always samples errors and bounds success sampling", () => {
    expect(metricSampleWeight("error", 0.999)).toBe(1);
    expect(metricSampleWeight("success", 0.1)).toBe(4);
    expect(metricSampleWeight("success", 0.9)).toBeNull();
  });

  it("drops unknown fields from structured logs", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logTelemetry("info", {
      requestId: "request_123",
      module: "core",
      operation: "read",
      outcome: "success",
      source: "worker",
      secret: "must-not-appear",
      messageContent: "private-message",
    } as never);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).not.toContain("must-not-appear");
    expect(line).not.toContain("private-message");
    expect(JSON.parse(line)).toMatchObject({ requestId: "request_123", module: "core" });
    spy.mockRestore();
  });

  it("aggregates weighted hourly metrics and purges after 30 days", async () => {
    const guildKey = await pseudonymizeGuild(env.SESSION_SECRET, GUILD);
    await recordOperationMetric(env.DB, {
      guildKey,
      module: "stats",
      operation: "read",
      outcome: "success",
      durationMs: 180,
      weight: 4,
    });
    await recordOperationMetric(env.DB, {
      guildKey,
      module: "stats",
      operation: "read",
      outcome: "error",
      durationMs: 700,
      weight: 1,
    });
    await recordOperationMetric(env.DB, {
      guildKey,
      module: "commands",
      operation: "write",
      outcome: "success",
      durationMs: 90,
      weight: 4,
      at: new Date(Date.now() - 31 * 86_400_000),
    });
    const rows = await listHealthMetrics(env.DB, guildKey, 24);
    const stats = rows.find((row) => row.module === "stats");
    expect(stats).toMatchObject({ eventCount: 5, sampleCount: 2, errorCount: 1, latencyLe250: 4, latencyLe1000: 1 });
    expect(await purgeObservabilityMetrics(env.DB, 30)).toBeGreaterThanOrEqual(1);
  });
});

describe("guild health API", () => {
  it("allows full panel admins, returns a diagnostic ID and no raw guild ID", async () => {
    const sid = await session(ADMIN);
    const response = await get(`/api/guilds/${GUILD}/health`, sid);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    const text = await response.text();
    expect(text).not.toContain(GUILD);
    expect(text).not.toContain("private-");
    const body = JSON.parse(text) as { retentionDays: number; sampled: boolean; windowHours: number; requestId: string };
    expect(body).toMatchObject({ retentionDays: 30, sampled: true, windowHours: 24 });
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("denies detailed health to read-only moderators", async () => {
    const sid = await session(MODERATOR);
    expect((await get(`/api/guilds/${GUILD}/health`, sid)).status).toBe(403);
  });
});
