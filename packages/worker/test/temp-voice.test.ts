import { beforeAll, describe, expect, it } from "vitest";
import { env, createExecutionContext, fetchMock } from "cloudflare:test";
import type { TempVoiceSettingsDto } from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import {
  countTempVoiceChannels,
  deleteTempVoiceChannel,
  disableTempVoice,
  getTempVoiceSettings,
  insertTempVoiceChannel,
  listAllTempVoiceChannels,
  listTempVoiceChannels,
  purgeTempVoiceChannels,
  setTempVoiceOwner,
  upsertGuild,
  upsertTempVoiceSettings,
} from "../src/db/queries.js";

const G = "990000000000000010";
const LOBBY = "990000000000000201"; // voice channel
const CATEGORY = "990000000000000202"; // category
const CH1 = "990000000000000301";
const CH2 = "990000000000000302";
const OWNER = "880000000000000010";

const BEARER = "Bearer test-internal-token";

function internal(path: string, init: RequestInit = {}, token = BEARER): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        ...init,
        headers: {
          ...(token ? { authorization: token } : {}),
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      },
      env,
      createExecutionContext(),
    ),
  );
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, G, "TempVoice Guild", null);
  // Panel guild-access check + channel-in-guild validation.
  fetchMock
    .get("https://discord.com")
    .intercept({ path: "/api/v10/users/@me/guilds", method: "GET" })
    .reply(200, [{ id: G, name: "TempVoice Guild", icon: null, owner: false, permissions: "32" }])
    .persist();
  for (const id of [LOBBY, CATEGORY]) {
    fetchMock
      .get("https://discord.com")
      .intercept({ path: `/api/v10/channels/${id}`, method: "GET" })
      .reply(200, { id, guild_id: G, type: id === CATEGORY ? 4 : 2 })
      .persist();
  }
});

describe("temp voice — queries", () => {
  it("settings roundtrip + disable clears the lobby", async () => {
    await upsertTempVoiceSettings(env.DB, G, {
      enabled: true,
      lobbyChannelId: LOBBY,
      categoryId: CATEGORY,
      lobbyCreatedByBot: true,
      nameTemplate: "🎧・{user}",
      userLimit: 3,
      maxChannels: 5,
    });
    const s = await getTempVoiceSettings(env.DB, G);
    expect(s).toMatchObject({ enabled: 1, lobby_channel_id: LOBBY, category_id: CATEGORY, user_limit: 3, max_channels: 5 });

    await disableTempVoice(env.DB, G, { clearLobby: true });
    const after = await getTempVoiceSettings(env.DB, G);
    expect(after?.enabled).toBe(0);
    expect(after?.lobby_channel_id).toBeNull();
    expect(after?.lobby_created_by_bot).toBe(0);
  });

  it("channel registry: insert, count, list, transfer, delete, purge", async () => {
    await insertTempVoiceChannel(env.DB, G, CH1, OWNER);
    await insertTempVoiceChannel(env.DB, G, CH2, OWNER);
    expect(await countTempVoiceChannels(env.DB, G)).toBe(2);
    expect((await listTempVoiceChannels(env.DB, G)).length).toBe(2);
    expect((await listAllTempVoiceChannels(env.DB)).map((r) => r.channel_id)).toEqual(expect.arrayContaining([CH1, CH2]));

    await setTempVoiceOwner(env.DB, CH1, "880000000000000099");
    expect((await listTempVoiceChannels(env.DB, G)).find((r) => r.channel_id === CH1)?.owner_id).toBe("880000000000000099");

    await deleteTempVoiceChannel(env.DB, G, CH1);
    expect(await countTempVoiceChannels(env.DB, G)).toBe(1);

    await purgeTempVoiceChannels(env.DB, G);
    expect(await countTempVoiceChannels(env.DB, G)).toBe(0);
  });
});

describe("temp voice — panel API", () => {
  async function session(): Promise<string> {
    return createSession(env, {
      userId: "880000000000000001",
      username: "admin",
      globalName: null,
      avatar: null,
      accessToken: "tok",
      refreshToken: "r",
      tokenExpiresAt: Date.now() + 3600_000,
      createdAt: Date.now(),
    });
  }

  it("serves defaults then stores settings", async () => {
    const sid = await session();
    const call = (init: RequestInit = {}): Promise<Response> =>
      Promise.resolve(
        app.request(
          `/api/guilds/${G}/temp-voice-settings`,
          { ...init, headers: { cookie: `session=${sid}`, ...(init.body ? { "content-type": "application/json" } : {}) } },
          env,
          createExecutionContext(),
        ),
      );

    const defaults = (await (await call()).json()) as TempVoiceSettingsDto;
    expect(defaults).toMatchObject({ enabled: false, lobbyChannelId: null, nameTemplate: "🎧・{user}", maxChannels: 10, activeChannels: 0 });

    const put = await call({
      method: "PUT",
      body: JSON.stringify({
        enabled: true,
        lobbyChannelId: LOBBY,
        categoryId: CATEGORY,
        nameTemplate: "Salon de {user}",
        userLimit: 5,
        maxChannels: 8,
      }),
    });
    expect(put.status).toBe(200);
    const read = (await (await call()).json()) as TempVoiceSettingsDto;
    expect(read).toMatchObject({ enabled: true, lobbyChannelId: LOBBY, categoryId: CATEGORY, userLimit: 5, maxChannels: 8 });
  });

  it("rejects an invalid body with 400", async () => {
    const sid = await session();
    const res = await app.request(
      `/api/guilds/${G}/temp-voice-settings`,
      {
        method: "PUT",
        headers: { cookie: `session=${sid}`, "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      },
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(400);
  });
});

describe("temp voice — internal API", () => {
  it("rejects requests without the bearer token", async () => {
    expect((await internal("/internal/temp-voice/channels", {}, "")).status).toBe(401);
  });

  it("registers, lists, counts and unregisters channels", async () => {
    const reg = await internal(`/internal/guilds/${G}/temp-voice/channels`, {
      method: "POST",
      body: JSON.stringify({ channelId: CH1, ownerId: OWNER }),
    });
    expect(reg.status).toBe(201);
    expect(((await reg.json()) as { count: number }).count).toBe(1);

    const bulk = (await (await internal("/internal/temp-voice/channels")).json()) as {
      channels: Array<{ channelId: string; guildId: string; ownerId: string }>;
    };
    expect(bulk.channels).toEqual(expect.arrayContaining([{ channelId: CH1, guildId: G, ownerId: OWNER }]));

    const del = await internal(`/internal/guilds/${G}/temp-voice/channels/${CH1}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await countTempVoiceChannels(env.DB, G)).toBe(0);
  });

  it("lobby-deleted disables the system and clears the lobby", async () => {
    await upsertTempVoiceSettings(env.DB, G, {
      enabled: true,
      lobbyChannelId: LOBBY,
      categoryId: null,
      lobbyCreatedByBot: true,
      nameTemplate: "🎧・{user}",
      userLimit: 0,
      maxChannels: 10,
    });
    const res = await internal(`/internal/guilds/${G}/temp-voice/lobby-deleted`, { method: "POST" });
    expect(res.status).toBe(200);
    const s = await getTempVoiceSettings(env.DB, G);
    expect(s?.enabled).toBe(0);
    expect(s?.lobby_channel_id).toBeNull();
  });

  it("guild config exposes the tempVoice block", async () => {
    await upsertTempVoiceSettings(env.DB, G, {
      enabled: true,
      lobbyChannelId: LOBBY,
      categoryId: CATEGORY,
      lobbyCreatedByBot: false,
      nameTemplate: "🎧・{user}",
      userLimit: 2,
      maxChannels: 6,
    });
    const cfg = (await (await internal(`/internal/guilds/${G}/config`)).json()) as {
      tempVoice: { enabled: boolean; lobbyChannelId: string | null; maxChannels: number };
    };
    expect(cfg.tempVoice).toMatchObject({ enabled: true, lobbyChannelId: LOBBY, maxChannels: 6 });
  });
});
