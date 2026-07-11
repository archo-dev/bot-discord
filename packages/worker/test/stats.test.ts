import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";
import { purgeOldStats } from "../src/db/queries.js";

// M18 — stats collection (/internal upserts) + retention purge (cron).

const G = "950000000000000001";
const CH = "750000000000000001";

function internal(path: string, body: unknown, token = "test-internal-token"): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) },
      env,
      createExecutionContext(),
    ),
  );
}

describe("stats collection (M18)", () => {
  it("channel-activity upserts additively (two flushes accumulate)", async () => {
    const first = await internal(`/internal/guilds/${G}/channel-activity`, {
      entries: [{ channelId: CH, day: "2026-07-11", messageCount: 3, voiceSeconds: 10 }],
    });
    expect(first.status).toBe(201);
    await internal(`/internal/guilds/${G}/channel-activity`, {
      entries: [{ channelId: CH, day: "2026-07-11", messageCount: 2, voiceSeconds: 5 }],
    });

    const row = await env.DB.prepare(
      `SELECT message_count, voice_seconds FROM channel_activity WHERE guild_id = ?1 AND channel_id = ?2 AND day = ?3`,
    )
      .bind(G, CH, "2026-07-11")
      .first<{ message_count: number; voice_seconds: number }>();
    expect(row?.message_count).toBe(5);
    expect(row?.voice_seconds).toBe(15);
  });

  it("member-snapshots replace on the same bucket (INSERT OR REPLACE)", async () => {
    await internal(`/internal/guilds/${G}/member-snapshots`, { bucket: "2026-07-11T10:00", total: 100, humans: 90, bots: 10 });
    await internal(`/internal/guilds/${G}/member-snapshots`, { bucket: "2026-07-11T10:00", total: 120, humans: 108, bots: 12 });

    const row = await env.DB.prepare(`SELECT total, humans FROM member_snapshots WHERE guild_id = ?1 AND bucket = ?2`)
      .bind(G, "2026-07-11T10:00")
      .first<{ total: number; humans: number }>();
    expect(row?.total).toBe(120);
    expect(row?.humans).toBe(108);
  });

  it("rejects internal writes without the bearer token", async () => {
    const res = await internal(`/internal/guilds/${G}/member-snapshots`, { bucket: "2026-07-11T10:00", total: 1, humans: 1, bots: 0 }, "wrong");
    expect(res.status).toBe(401);
  });

  it("purge enforces the retention bounds", async () => {
    const P = "950000000000000009"; // isolated guild for the purge test
    // voice_logs: 100 d old (purged) + 1 d old (kept).
    await env.DB.prepare(
      `INSERT INTO voice_logs (guild_id, user_id, action, channel_id, created_at) VALUES
        (?1, 'u', 'join', ?2, datetime('now','-100 days')),
        (?1, 'u', 'join', ?2, datetime('now','-1 days'))`,
    )
      .bind(P, CH)
      .run();
    // channel_activity: 200 d old (purged) + today (kept).
    await env.DB.prepare(
      `INSERT INTO channel_activity (guild_id, channel_id, day, message_count) VALUES
        (?1, ?2, date('now','-200 days'), 1),
        (?1, ?2, date('now'), 1)`,
    )
      .bind(P, CH)
      .run();
    // member_snapshots: hourly@-20d (purged), daily@-20d (kept), daily@-500d (purged), hourly@-5d (kept).
    await env.DB.prepare(
      `INSERT INTO member_snapshots (guild_id, bucket, total, humans, bots, created_at) VALUES
        (?1, '2020-01-01T05:00', 1, 1, 0, datetime('now','-20 days')),
        (?1, '2020-01-02T00:00', 1, 1, 0, datetime('now','-20 days')),
        (?1, '2019-01-01T00:00', 1, 1, 0, datetime('now','-500 days')),
        (?1, '2020-01-03T06:00', 1, 1, 0, datetime('now','-5 days'))`,
    )
      .bind(P)
      .run();

    const purged = await purgeOldStats(env.DB);
    expect(purged.voiceLogs).toBe(1);
    expect(purged.channelActivity).toBe(1);
    expect(purged.hourlySnapshots).toBe(1); // the -20d hourly
    expect(purged.oldSnapshots).toBe(1); // the -500d daily

    const remaining = await env.DB.prepare(`SELECT bucket FROM member_snapshots WHERE guild_id = ?1 ORDER BY bucket`)
      .bind(P)
      .all<{ bucket: string }>();
    expect(remaining.results.map((r) => r.bucket)).toEqual(["2020-01-02T00:00", "2020-01-03T06:00"]);
  });
});
