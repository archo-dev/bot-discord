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
