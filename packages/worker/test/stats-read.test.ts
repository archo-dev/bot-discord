import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { listMemberDeltas, listMemberSnapshots, topChannels, upsertGuild } from "../src/db/queries.js";

// M19 — stats read aggregations (feed the Stats page).

const G = "960000000000000001";
const CH_A = "760000000000000001";
const CH_B = "760000000000000002";

beforeAll(async () => {
  await upsertGuild(env.DB, G, "Stats Guild", null);

  // A daily (T00:00) and an hourly (T05:00) snapshot, both created recently.
  await env.DB.prepare(
    `INSERT INTO member_snapshots (guild_id, bucket, total, humans, bots, created_at) VALUES
      (?1, '2026-07-11T00:00', 100, 90, 10, datetime('now')),
      (?1, '2026-07-11T05:00', 102, 92, 10, datetime('now'))`,
  )
    .bind(G)
    .run();

  // Joins/leaves today (default created_at = now).
  await env.DB.prepare(
    `INSERT INTO gateway_events (guild_id, event_type, payload) VALUES
      (?1, 'member_join', '{}'), (?1, 'member_join', '{}'), (?1, 'member_leave', '{}')`,
  )
    .bind(G)
    .run();

  // Channel activity today.
  await env.DB.prepare(
    `INSERT INTO channel_activity (guild_id, channel_id, day, message_count, voice_seconds) VALUES
      (?1, ?2, date('now'), 10, 100),
      (?1, ?3, date('now'), 20, 50)`,
  )
    .bind(G, CH_A, CH_B)
    .run();
});

describe("stats read aggregations (M19)", () => {
  it("returns hourly points at 7d and daily-only for longer windows", async () => {
    const hourly = await listMemberSnapshots(env.DB, G, 7, "hourly");
    expect(hourly.map((s) => s.bucket)).toEqual(["2026-07-11T00:00", "2026-07-11T05:00"]);

    const daily = await listMemberSnapshots(env.DB, G, 30, "daily");
    expect(daily.map((s) => s.bucket)).toEqual(["2026-07-11T00:00"]);
  });

  it("aggregates joins/leaves per day", async () => {
    const deltas = await listMemberDeltas(env.DB, G, 30);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.joins).toBe(2);
    expect(deltas[0]?.leaves).toBe(1);
  });

  it("ranks top channels by messages and by voice separately", async () => {
    const messages = await topChannels(env.DB, G, 7, "messages", 10);
    expect(messages.map((c) => [c.channelId, c.value])).toEqual([
      [CH_B, 20],
      [CH_A, 10],
    ]);

    const voice = await topChannels(env.DB, G, 7, "voice", 10);
    expect(voice.map((c) => [c.channelId, c.value])).toEqual([
      [CH_A, 100],
      [CH_B, 50],
    ]);
  });
});
