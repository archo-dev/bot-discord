import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { signInternalRequest } from "@bot/shared";
import app from "../src/index.js";
import { consumeDurableQuota, purgeSecurityData } from "../src/db/queries.js";

describe("M02 atomic security storage", () => {
  it("atomically accepts an internal nonce only once under concurrency", async () => {
    const body = JSON.stringify({
      guildCount: 1,
      wsPing: 20,
      runtime: {
        version: "m02-test", uptimeSeconds: 1, memoryRssMb: 64,
        voiceLogQueueDepth: 0, channelActivityQueueDepth: 0, errorsSinceLastHeartbeat: 0,
      },
    });
    const signature = await signInternalRequest({
      masterSecret: "test-internal-token", keyId: "gw-current",
      direction: "gateway-to-worker", audience: "worker-internal",
      method: "POST", path: "/internal/gateway/heartbeat", body,
      nonce: "c".repeat(32),
    });
    const signedEnv = { ...env, INTERNAL_AUTH_MODE: "signed" as const };
    const responses = await Promise.all(Array.from({ length: 8 }, () => app.request("/internal/gateway/heartbeat", {
      method: "POST", headers: { "content-type": "application/json", ...signature }, body,
    }, signedEnv, createExecutionContext())));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(7);
  });

  it("caps durable guild/user quotas atomically", async () => {
    const input = {
      day: "2026-07-13", guildKey: "a".repeat(32), guildScopeKey: "b".repeat(32), userScopeKey: "c".repeat(32),
      capability: "discord_publish" as const, guildLimit: 3, userLimit: 2,
    };
    const accepted = await Promise.all(Array.from({ length: 8 }, () => consumeDurableQuota(env.DB, input)));
    expect(accepted.filter(Boolean)).toHaveLength(2);
    const counts = await env.DB.prepare(
      `SELECT scope_type, count FROM security_quota_usage WHERE day = ?1 AND guild_key = ?2 ORDER BY scope_type`,
    ).bind(input.day, input.guildKey).all<{ scope_type: string; count: number }>();
    expect(counts.results).toEqual([
      { scope_type: "guild", count: 2 },
      { scope_type: "user", count: 2 },
    ]);
  });

  it("keeps search preview quota independent from music mutations", async () => {
    const common = {
      day: "2026-07-19",
      guildLimit: 1,
      userLimit: 1,
      capability: "music_control" as const,
    };
    const search = {
      ...common,
      guildKey: "1".repeat(32),
      guildScopeKey: "2".repeat(32),
      userScopeKey: "3".repeat(32),
    };
    const controls = {
      ...common,
      guildKey: "4".repeat(32),
      guildScopeKey: "5".repeat(32),
      userScopeKey: "6".repeat(32),
    };
    expect(await consumeDurableQuota(env.DB, search)).toBe(true);
    expect(await consumeDurableQuota(env.DB, search)).toBe(false);
    expect(await consumeDurableQuota(env.DB, controls)).toBe(true);
    const rows = await env.DB.prepare(
      `SELECT guild_key, scope_type, count FROM security_quota_usage
       WHERE day = ?1 AND guild_key IN (?2, ?3) ORDER BY guild_key, scope_type`,
    ).bind(common.day, search.guildKey, controls.guildKey).all<{ guild_key: string; scope_type: string; count: number }>();
    expect(rows.results).toEqual([
      { guild_key: search.guildKey, scope_type: "guild", count: 1 },
      { guild_key: search.guildKey, scope_type: "user", count: 1 },
      { guild_key: controls.guildKey, scope_type: "guild", count: 1 },
      { guild_key: controls.guildKey, scope_type: "user", count: 1 },
    ]);
  });

  it("purges expired nonces, quotas and audit rows", async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO internal_request_nonces VALUES ('gateway-to-worker', ?1, datetime('now','-1 day'), datetime('now','-1 day'))`).bind("d".repeat(64)),
      env.DB.prepare(`INSERT INTO security_quota_usage VALUES (date('now','-8 days'), ?1, 'guild', ?2, 'discord_publish', 1, datetime('now','-8 days'))`).bind("e".repeat(32), "f".repeat(32)),
      env.DB.prepare(`INSERT INTO admin_audit_log (guild_id,actor_id,actor_access,capability,method,outcome,status,request_id,created_at) VALUES ('1','2','manage_guild','guild_config_write','PUT','success',200,'request-old',datetime('now','-91 days'))`),
    ]);
    const purged = await purgeSecurityData(env.DB);
    expect(purged).toEqual({ nonces: 1, quotas: 1, audit: 1 });
  });
});
