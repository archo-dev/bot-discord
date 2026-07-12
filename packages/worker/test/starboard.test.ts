import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import type { StarboardSettingsDto } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { getStarboardPost, upsertGuild, upsertStarboardSettings } from "../src/db/queries.js";

const G = "990000000000000001";
const SB_CHANNEL = "990000000000000101"; // starboard channel
const SRC_CHANNEL = "990000000000000102"; // where the starred message lives
const SRC_MSG = "990000000000000777";
const SB_MSG = "990000000000000888"; // the embed posted to the starboard channel

function internalPost(count: number): Promise<Response> {
  return Promise.resolve(
    app.request(
      `/internal/guilds/${G}/starboard`,
      {
        method: "POST",
        headers: { authorization: "Bearer test-internal-token", "content-type": "application/json" },
        body: JSON.stringify({
          messageId: SRC_MSG,
          channelId: SRC_CHANNEL,
          authorTag: "bob",
          authorAvatarUrl: null,
          content: "un message génial",
          imageUrl: null,
          count,
        }),
      },
      env,
      createExecutionContext(),
    ),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, G, "Star Guild", null);
  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: G, name: "Star Guild", icon: null, owner: false, permissions: "32" }])
    .persist();
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/channels/${SB_CHANNEL}`, method: "GET" })
    .reply(200, { id: SB_CHANNEL, guild_id: G, type: 0 })
    .persist();
});

describe("starboard settings API (M23)", () => {
  it("serves defaults and stores settings", async () => {
    const sid = await createSession(env, {
      userId: "880000000000000001",
      username: "admin",
      globalName: null,
      avatar: null,
      accessToken: "tok",
      refreshToken: "r",
      tokenExpiresAt: Date.now() + 3600_000,
      createdAt: Date.now(),
    });
    const call = (init: RequestInit = {}): Promise<Response> =>
      Promise.resolve(
        app.request(
          `/api/guilds/${G}/starboard-settings`,
          { ...init, headers: { cookie: `session=${sid}`, ...(init.body ? { "content-type": "application/json" } : {}) } },
          env,
          createExecutionContext(),
        ),
      );

    const defaults = (await (await call()).json()) as StarboardSettingsDto;
    expect(defaults).toMatchObject({ enabled: false, channelId: null, threshold: 3, emoji: "⭐" });

    const put = await call({
      method: "PUT",
      body: JSON.stringify({ enabled: true, channelId: SB_CHANNEL, threshold: 4, emoji: "⭐" }),
    });
    expect(put.status).toBe(200);
    const read = (await (await call()).json()) as StarboardSettingsDto;
    expect(read).toMatchObject({ enabled: true, channelId: SB_CHANNEL, threshold: 4 });
  });
});

describe("starboard lifecycle (M23)", () => {
  it("posts at threshold, edits on change, removes below threshold", async () => {
    await upsertStarboardSettings(env.DB, G, { enabled: true, channelId: SB_CHANNEL, threshold: 3, emoji: "⭐" });

    // Below threshold: nothing posted (disableNetConnect would throw on any REST call).
    await internalPost(2);
    expect(await getStarboardPost(env.DB, G, SRC_MSG)).toBeNull();

    // Reaches threshold → posts a new embed.
    fetchMock
      .get("https://discord.com")
      .intercept({ path: `/api/v10/channels/${SB_CHANNEL}/messages`, method: "POST" })
      .reply(200, { id: SB_MSG });
    await internalPost(3);
    const posted = await getStarboardPost(env.DB, G, SRC_MSG);
    expect(posted?.starboard_message_id).toBe(SB_MSG);
    expect(posted?.star_count).toBe(3);

    // Count grows → edits the existing embed.
    fetchMock
      .get("https://discord.com")
      .intercept({ path: `/api/v10/channels/${SB_CHANNEL}/messages/${SB_MSG}`, method: "PATCH" })
      .reply(200, {});
    await internalPost(6);
    expect((await getStarboardPost(env.DB, G, SRC_MSG))?.star_count).toBe(6);

    // Drops below threshold → deletes the embed and the tracking row.
    fetchMock
      .get("https://discord.com")
      .intercept({ path: `/api/v10/channels/${SB_CHANNEL}/messages/${SB_MSG}`, method: "DELETE" })
      .reply(204, "");
    await internalPost(1);
    expect(await getStarboardPost(env.DB, G, SRC_MSG)).toBeNull();
  });
});
