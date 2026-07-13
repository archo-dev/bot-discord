import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";
import { ensureGuildModules, upsertGuild } from "../src/db/queries.js";
import { RELIABLE_DELIVERY_SCHEMA_VERSION, type ReliableBatchResponse } from "@bot/shared";

const G = "990000000000000042";

function post(body: unknown, token = "test-internal-token"): Promise<Response> {
  return Promise.resolve(
    app.request(
      "/internal/events/batch",
      { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) },
      env,
      createExecutionContext(),
    ),
  );
}

let seq = 0;
function voiceLogEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: RELIABLE_DELIVERY_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    type: "voice_log",
    guildId: G,
    partitionKey: `g:${G}`,
    priority: 0,
    occurredAt: Date.now() + seq++,
    payload: { userId: "111111111111111111", userTag: "x", action: "join", channelId: "222222222222222222", fromChannelId: null },
    ...overrides,
  };
}

async function voiceLogCount(): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM voice_logs WHERE guild_id = ?1`).bind(G).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("reliable delivery — /internal/events/batch", () => {
  beforeAll(async () => {
    await upsertGuild(env.DB, G, "Reliable Guild", null);
    await ensureGuildModules(env.DB, G);
  });

  it("rejects without the internal token", async () => {
    expect((await post({ events: [voiceLogEvent()] }, "")).status).toBe(401);
  });

  it("applies a new event once (accepted) and writes exactly one row", async () => {
    const ev = voiceLogEvent();
    const res = await post({ events: [ev] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReliableBatchResponse;
    expect(body.results).toEqual([{ eventId: ev.eventId, status: "accepted" }]);
    expect(await voiceLogCount()).toBe(1);
  });

  it("deduplicates a replayed eventId (no double apply)", async () => {
    const ev = voiceLogEvent();
    await post({ events: [ev] }); // first delivery
    const replay = await post({ events: [ev] }); // ACK lost → gateway retries
    const body = (await replay.json()) as ReliableBatchResponse;
    expect(body.results[0]!.status).toBe("duplicate");
    expect(await voiceLogCount()).toBe(1); // still one row
  });

  it("deduplicates within a single batch (same eventId twice)", async () => {
    const ev = voiceLogEvent();
    const res = await post({ events: [ev, { ...ev }] });
    const body = (await res.json()) as ReliableBatchResponse;
    const statuses = body.results.map((r) => r.status).sort();
    // One applied, the other seen as already-processed in the same batch scan or retry.
    expect(statuses).toContain("accepted");
    expect(await voiceLogCount()).toBe(1);
  });

  it("skips an event whose module is disabled (removed from outbox, not retried)", async () => {
    await env.DB.prepare(`UPDATE guild_modules SET enabled = 0, authority = 'governance' WHERE guild_id = ?1 AND module_id = 'voice_logs'`).bind(G).run();
    const ev = voiceLogEvent();
    const res = await post({ events: [ev] });
    const body = (await res.json()) as ReliableBatchResponse;
    expect(body.results[0]!.status).toBe("skipped");
    expect(await voiceLogCount()).toBe(0);
    await env.DB.prepare(`UPDATE guild_modules SET enabled = 1 WHERE guild_id = ?1 AND module_id = 'voice_logs'`).bind(G).run();
  });

  it("marks a poison event invalid (dead-letter, never retried)", async () => {
    const bad = voiceLogEvent({ payload: { userId: "nope", userTag: "x", action: "explode", channelId: null, fromChannelId: null } });
    const res = await post({ events: [bad] });
    // The outer schema rejects a bad action enum at the batch level → 400,
    // OR per-event invalid. Either way no row is written.
    if (res.status === 200) {
      const body = (await res.json()) as ReliableBatchResponse;
      expect(body.results[0]!.status).toBe("invalid");
    } else {
      expect(res.status).toBe(400);
    }
    expect(await voiceLogCount()).toBe(0);
  });

  it("processes a mixed batch (accepted + duplicate)", async () => {
    const a = voiceLogEvent();
    await post({ events: [a] });
    const b = voiceLogEvent();
    const res = await post({ events: [a, b] });
    const body = (await res.json()) as ReliableBatchResponse;
    const byId = new Map(body.results.map((r) => [r.eventId, r.status]));
    expect(byId.get(a.eventId)).toBe("duplicate");
    expect(byId.get(b.eventId)).toBe("accepted");
    expect(await voiceLogCount()).toBe(2);
  });
});
