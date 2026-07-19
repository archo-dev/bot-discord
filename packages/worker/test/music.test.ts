import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import type { MusicStateDto, PlaylistSummaryDto } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { upsertGuild } from "../src/db/queries.js";

const G = "950000000000000001";

async function makeSession(userId: string): Promise<string> {
  return createSession(env, {
    userId,
    username: `user${userId.slice(-2)}`,
    globalName: null,
    avatar: null,
    accessToken: `token-${userId}`,
    refreshToken: "r",
    tokenExpiresAt: Date.now() + 3600_000,
    createdAt: Date.now(),
  });
}

function panel(path: string, sessionId: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      { ...init, headers: { cookie: `session=${sessionId}`, ...(init.body ? { "content-type": "application/json" } : {}) } },
      env,
      createExecutionContext(),
    ),
  );
}

function internal(path: string, method: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        method,
        headers: { authorization: "Bearer test-internal-token", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      env,
      createExecutionContext(),
    ),
  );
}

const TRACKS = [
  { title: "Track A", url: "https://x/a", duration: 100, thumbnail: null, requestedBy: "1" },
  { title: "Track B", url: "https://x/b", duration: 200, thumbnail: null, requestedBy: "1" },
];

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, G, "Music Guild", null);
  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: G, name: "Music Guild", icon: null, owner: false, permissions: "32" }])
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: /\/api\/v10\/guilds\/\d+\?with_counts=true/, method: "GET" })
    .reply(200, { id: G, name: "Music Guild", icon: null, approximate_member_count: 3 })
    .persist();
});

describe("music state", () => {
  it("returns an empty state when nothing is cached", async () => {
    const sid = await makeSession("850000000000000001");
    const res = await panel(`/api/guilds/${G}/music-state`, sid);
    expect(res.status).toBe(200);
    const state = (await res.json()) as MusicStateDto;
    expect(state.connected).toBe(false);
    expect(state.status).toBe("idle");
    expect(state.seekable).toBe(false);
    expect(state.sequence).toBe(0);
    expect(state.current).toBeNull();
    expect(state.queue).toEqual([]);
  });

  it("returns the gateway-published state", async () => {
    const published: MusicStateDto = {
      status: "playing",
      connected: true,
      paused: false,
      seekable: true,
      current: { title: "Now", url: "https://x/n", duration: 210, thumbnail: null, requestedBy: "1" },
      elapsed: 42,
      queue: [{ title: "Next", url: "https://x/2", duration: 100, thumbnail: null, requestedBy: "1" }],
      loop: "song",
      volume: 80,
      voiceChannelId: "9",
      sequence: Date.now(),
      updatedAt: Date.now(),
    };
    expect((await internal(`/internal/guilds/${G}/music-state`, "POST", published)).status).toBe(200);

    const sid = await makeSession("850000000000000002");
    const state = (await (await panel(`/api/guilds/${G}/music-state`, sid)).json()) as MusicStateDto;
    expect(state.connected).toBe(true);
    expect(state.current?.title).toBe("Now");
    expect(state.elapsed).toBe(42);
    expect(state.loop).toBe("song");
    expect(state.status).toBe("playing");
    expect(state.seekable).toBe(true);
  });

  it("normalizes legacy snapshots and rejects delayed KV overwrites", async () => {
    const baseSequence = Date.now() + 1_000;
    const legacy = {
      connected: true,
      paused: true,
      current: { title: "Legacy", url: "https://x/legacy", duration: 120, thumbnail: null, requestedBy: null },
      elapsed: 12,
      queue: [],
      loop: "off",
      volume: 50,
      voiceChannelId: "9",
      updatedAt: baseSequence,
    };
    expect((await internal(`/internal/guilds/${G}/music-state`, "POST", legacy)).status).toBe(200);

    const recent = {
      ...legacy,
      status: "playing" as const,
      paused: false,
      seekable: true,
      sequence: baseSequence + 2,
      updatedAt: baseSequence + 2,
    };
    const stale = {
      ...recent,
      status: "buffering" as const,
      sequence: baseSequence + 1,
      updatedAt: baseSequence + 1,
    };
    expect((await internal(`/internal/guilds/${G}/music-state`, "POST", recent)).status).toBe(200);
    const ignored = await internal(`/internal/guilds/${G}/music-state`, "POST", stale);
    expect(await ignored.json()).toEqual({ ok: true, ignored: "stale_sequence" });

    const sid = await makeSession("850000000000000005");
    const result = (await (await panel(`/api/guilds/${G}/music-state`, sid)).json()) as MusicStateDto;
    expect(result).toMatchObject({ status: "playing", paused: false, sequence: baseSequence + 2 });
  });

  it("strictly validates every panel control before forwarding to the Gateway", async () => {
    const sid = await makeSession("850000000000000003");
    const valid = [
      { action: "pause" },
      { action: "resume" },
      { action: "skip" },
      { action: "stop" },
      { action: "shuffle" },
      { action: "volume", value: 75 },
      { action: "repeat", mode: "queue" },
      { action: "remove", position: 1 },
      { action: "seek", position: 90 },
    ];
    for (const body of valid) {
      const res = await panel(`/api/guilds/${G}/music-control`, sid, {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(503);
    }

    for (const body of [
      { action: "volume", value: 151 },
      { action: "repeat", mode: "invalid" },
      { action: "remove", position: 0 },
      { action: "seek", position: -1 },
      { action: "reorder", from: 1, to: 2 },
      { action: "pause", unexpected: true },
    ]) {
      const res = await panel(`/api/guilds/${G}/music-control`, sid, {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("playlists", () => {
  it("saves via /internal, reads back, and lists in the panel", async () => {
    const save = await internal(`/internal/guilds/${G}/playlists`, "POST", { ownerId: "111111111", name: "chill", tracks: TRACKS });
    expect(save.status).toBe(201);

    const read = await internal(`/internal/guilds/${G}/playlists/chill`, "GET");
    expect(read.status).toBe(200);
    expect(((await read.json()) as { tracks: unknown[] }).tracks).toHaveLength(2);

    const sid = await makeSession("850000000000000004");
    const list = (await (await panel(`/api/guilds/${G}/playlists`, sid)).json()) as PlaylistSummaryDto[];
    expect(list.find((p) => p.name === "chill")?.trackCount).toBe(2);
  });

  it("404s an unknown playlist and 400s a bad save", async () => {
    expect((await internal(`/internal/guilds/${G}/playlists/nope`, "GET")).status).toBe(404);
    expect((await internal(`/internal/guilds/${G}/playlists`, "POST", { name: "x" })).status).toBe(400);
  });
});
