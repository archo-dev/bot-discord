import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPlayerStatus } from "@discordjs/voice";
import { Events as DTEvents, type DisTube, type Queue, type Song } from "distube";
import type { Client } from "discord.js";
import type { MusicCommandPayload } from "@bot/shared";
import { MusicController } from "../src/music/controller.js";
import type { WorkerApi } from "../src/worker-api.js";

const ytDlpMocks = vi.hoisted(() => ({ json: vi.fn() }));

vi.mock("@distube/yt-dlp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@distube/yt-dlp")>();
  return { ...actual, json: ytDlpMocks.json };
});

const GUILD_ID = "123456789012345678";
const USER_ID = "223456789012345678";
const VOICE_CHANNEL_ID = "323456789012345678";
const TEXT_CHANNEL_ID = "423456789012345678";

function payload(arg: string, source: "interaction" | "panel"): MusicCommandPayload {
  return {
    command: "play",
    guildId: GUILD_ID,
    userId: USER_ID,
    textChannelId: TEXT_CHANNEL_ID,
    applicationId: null,
    token: null,
    arg,
    source,
  };
}

function createHarness() {
  const player = Object.assign(new EventEmitter(), { state: { status: AudioPlayerStatus.Playing } });
  const voice = {
    audioPlayer: player,
    connection: Object.assign(new EventEmitter(), { state: { status: "ready" } }),
    stream: undefined,
    pausingStream: undefined,
  };
  let queue: Queue | undefined;
  const voiceChannel = {
    id: VOICE_CHANNEL_ID,
    guildId: GUILD_ID,
    guild: { id: GUILD_ID },
    constructor: { name: "VoiceChannel" },
  };
  const member = { id: USER_ID, voice: { channel: voiceChannel, channelId: VOICE_CHANNEL_ID } };
  const guild = {
    id: GUILD_ID,
    members: {
      me: { voice: { channelId: VOICE_CHANNEL_ID } },
      fetch: vi.fn().mockResolvedValue(member),
    },
  };
  const textChannel = { id: TEXT_CHANNEL_ID, isTextBased: () => true, isDMBased: () => false };

  const distube = Object.assign(new EventEmitter(), {
    plugins: [],
    getQueue: vi.fn((resolvable: string | { guildId?: string; guild?: { id?: string } }) => {
      const guildId = typeof resolvable === "string"
        ? resolvable
        : resolvable.guildId ?? resolvable.guild?.id;
      if (guildId === "test") throw new Error("invalid test GuildIdResolvable");
      return guildId === GUILD_ID ? queue : undefined;
    }),
    voices: {
      get: vi.fn((guildId: string) => (guildId === GUILD_ID && queue ? voice : undefined)),
      leave: vi.fn(),
    },
    play: vi.fn(async (channel: typeof voiceChannel, query: unknown, options: { metadata?: unknown }) => {
      // DisTube runs its ffmpeg bootstrap check while creating the first Queue.
      // Its diagnostic prefix is a label, not a Discord guild ID.
      distube.emit(DTEvents.FFMPEG_DEBUG, "[test] spawn ffmpeg at '/usr/bin/ffmpeg' path");
      const added = {
        id: "resolved-track",
        name: String(query),
        url: String(query),
        duration: 180,
        metadata: options.metadata,
      } as Song;
      queue = {
        id: GUILD_ID,
        songs: [added],
        previousSongs: [],
        paused: false,
        stopped: false,
        voice,
        textChannel,
        currentTime: 0,
        repeatMode: 0,
        volume: 50,
        voiceChannel: channel,
      } as unknown as Queue;
      distube.emit(DTEvents.ADD_SONG, queue, added);
    }),
  }) as unknown as DisTube & EventEmitter & {
    play: ReturnType<typeof vi.fn>;
    getQueue: ReturnType<typeof vi.fn>;
  };

  const client = {
    guilds: { cache: { get: (id: string) => (id === GUILD_ID ? guild : undefined) }, fetch: vi.fn() },
    channels: { cache: { get: (id: string) => (id === TEXT_CHANNEL_ID ? textChannel : undefined) }, fetch: vi.fn() },
  } as unknown as Client;
  const api = { postMusicState: vi.fn().mockResolvedValue(undefined) } as unknown as WorkerApi;
  const controller = new MusicController(client, distube, api, "soundcloud");
  controller.registerEvents();
  return { controller, distube, guild, member, voiceChannel };
}

afterEach(() => {
  ytDlpMocks.json.mockReset();
  vi.restoreAllMocks();
});

describe("MusicController — runtime Discord playback context", () => {
  it.each([
    { name: "text search", arg: "Artist Track", source: "interaction" as const, expected: "https://soundcloud.com/artist/track" },
    {
      name: "direct SoundCloud track",
      arg: "https://soundcloud.com/artist/direct-track",
      source: "interaction" as const,
      expected: "https://soundcloud.com/artist/direct-track",
    },
    {
      name: "direct SoundCloud set",
      arg: "https://soundcloud.com/mathis-miot/sets/nouveaute-rap-francais-2026",
      source: "interaction" as const,
      expected: "https://soundcloud.com/mathis-miot/sets/nouveaute-rap-francais-2026",
    },
  ])("preserves the real voice channel for $name", async ({ arg, source, expected }) => {
    if (arg === "Artist Track") {
      ytDlpMocks.json.mockResolvedValueOnce({
        entries: [{
          title: "Artist - Track",
          uploader: "Artist",
          duration: 180,
          webpage_url: expected,
        }],
      });
    }
    const { controller, distube, guild, member, voiceChannel } = createHarness();

    const result = await controller.handle(payload(arg, source));

    expect(result.ok).toBe(true);
    expect(guild.members.fetch).toHaveBeenCalledWith(USER_ID);
    expect(member.voice.channel).toBe(voiceChannel);
    expect(voiceChannel.guild.id).toBe(GUILD_ID);
    expect(voiceChannel.guildId).toBe(GUILD_ID);
    expect(distube.play).toHaveBeenCalledOnce();
    expect(distube.play).toHaveBeenCalledWith(
      voiceChannel,
      expected,
      expect.objectContaining({ member, textChannel: expect.objectContaining({ id: TEXT_CHANNEL_ID }) }),
    );
    expect(distube.play.mock.calls[0]?.[0]).not.toBe("test");
    expect(distube.getQueue).not.toHaveBeenCalledWith("test");
  });
});
