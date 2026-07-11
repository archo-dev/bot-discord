import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";
import { insertVoiceLogs, listVoiceLogs, upsertGuild, type VoiceLogEntry } from "../src/db/queries.js";

// M17 — voice logs: batch insert (gateway → /internal) and keyset-paginated,
// filterable listing (panel GET).

const G = "940000000000000101";
const G2 = "940000000000000102";
const USER_A = "840000000000000001";
const USER_B = "840000000000000002";
const CH_1 = "740000000000000001";
const CH_2 = "740000000000000002";

function entry(over: Partial<VoiceLogEntry>): VoiceLogEntry {
  return { userId: USER_A, userTag: "a#0", action: "join", channelId: CH_1, fromChannelId: null, ...over };
}

function internal(path: string, init: RequestInit = {}, token = "test-internal-token"): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
      env,
      createExecutionContext(),
    ),
  );
}

// vitest-pool-workers isolates D1 per `it` but keeps beforeAll writes, so the
// shared fixture (3 rows in G, 1 in G2) is seeded once here.
beforeAll(async () => {
  await upsertGuild(env.DB, G, "Voice Guild", null);
  await insertVoiceLogs(env.DB, G, [
    entry({ action: "join", userId: USER_A }),
    entry({ action: "move", userId: USER_B, channelId: CH_2, fromChannelId: CH_1 }),
    entry({ action: "leave", userId: USER_A, channelId: CH_2 }),
  ]);
  await insertVoiceLogs(env.DB, G2, [entry({ action: "join" })]);
});

describe("voice logs (M17)", () => {
  it("lists newest-first, scoped per guild", async () => {
    const { rows } = await listVoiceLogs(env.DB, G, { limit: 50 });
    expect(rows).toHaveLength(3);
    // Newest first (id DESC on equal timestamps): leave was inserted last.
    expect(rows[0]?.action).toBe("leave");
    expect(rows.every((r) => r.guild_id === G)).toBe(true);
  });

  it("filters by user and by action", async () => {
    const byUser = await listVoiceLogs(env.DB, G, { userId: USER_B, limit: 50 });
    expect(byUser.rows).toHaveLength(1);
    expect(byUser.rows[0]?.action).toBe("move");
    expect(byUser.rows[0]?.from_channel_id).toBe(CH_1);

    const byAction = await listVoiceLogs(env.DB, G, { action: "join", limit: 50 });
    expect(byAction.rows).toHaveLength(1);
    expect(byAction.rows[0]?.user_id).toBe(USER_A);
  });

  it("filters by channel, matching both channel_id and from_channel_id", async () => {
    // CH_1: the join (channel_id) and the move (from_channel_id).
    const byChannel = await listVoiceLogs(env.DB, G, { channelId: CH_1, limit: 50 });
    expect(byChannel.rows.map((r) => r.action).sort()).toEqual(["join", "move"]);
  });

  it("keyset-paginates with a cursor", async () => {
    const first = await listVoiceLogs(env.DB, G, { limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const [createdAt, idStr] = first.nextCursor!.split("|");
    const second = await listVoiceLogs(env.DB, G, {
      limit: 2,
      cursor: { createdAt: createdAt!, id: Number(idStr) },
    });
    expect(second.rows).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    // No overlap between pages.
    const firstIds = new Set(first.rows.map((r) => r.id));
    expect(second.rows.every((r) => !firstIds.has(r.id))).toBe(true);
  });

  it("internal endpoint requires the bearer token and validates the batch", async () => {
    const noAuth = await internal(`/internal/guilds/${G}/voice-logs`, {
      method: "POST",
      body: JSON.stringify({ entries: [entry({})] }),
    }, "wrong");
    expect(noAuth.status).toBe(401);

    const empty = await internal(`/internal/guilds/${G}/voice-logs`, {
      method: "POST",
      body: JSON.stringify({ entries: [] }),
    });
    expect(empty.status).toBe(400);

    const ok = await internal(`/internal/guilds/${G}/voice-logs`, {
      method: "POST",
      body: JSON.stringify({ entries: [entry({ action: "join", userId: USER_A })] }),
    });
    expect(ok.status).toBe(201);
  });
});
