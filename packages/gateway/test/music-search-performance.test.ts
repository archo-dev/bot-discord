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

const searchInfo = {
  entries: [
    {
      title: "Artist - Track",
      uploader: "Artist",
      duration: 180,
      webpage_url: "https://soundcloud.com/artist/track",
    },
  ],
};

function payload(guildId: string, arg: string): MusicCommandPayload {
  return {
    command: "play",
    guildId,
    userId: `user-${guildId}`,
    textChannelId: `text-${guildId}`,
    applicationId: null,
    token: null,
    arg,
    source: "panel",
  };
}

function createHarness() {
  const queues = new Map<string, Queue>();
  const voices = new Map<string, { audioPlayer: EventEmitter & { state: { status: AudioPlayerStatus } } }>();
  const queueFor = (guildId: string): Queue => {
    const existing = queues.get(guildId);
    if (existing) return existing;
    const player = Object.assign(new EventEmitter(), { state: { status: AudioPlayerStatus.Playing } });
    const voice = {
      audioPlayer: player,
      connection: Object.assign(new EventEmitter(), { state: { status: "ready" } }),
      stream: undefined,
      pausingStream: undefined,
    };
    voices.set(guildId, voice);
    const current = {
      name: `${guildId} Current`,
      url: `https://soundcloud.com/${guildId}/current`,
      duration: 180,
    } as Song;
    const queue = {
      id: guildId,
      songs: [current],
      previousSongs: [],
      paused: false,
      stopped: false,
      voice,
      currentTime: 0,
      repeatMode: 0,
      volume: 50,
      voiceChannel: { id: `voice-${guildId}` },
      resume: vi.fn(),
      stop: vi.fn(),
    } as unknown as Queue;
    queues.set(guildId, queue);
    return queue;
  };
  queueFor("g1");
  queueFor("g2");

  const distube = Object.assign(new EventEmitter(), {
    getQueue: vi.fn((guildId: string) => queues.get(guildId)),
    voices: {
      get: vi.fn((guildId: string) => voices.get(guildId)),
      leave: vi.fn(),
    },
    play: vi.fn(async (channel: { guild: { id: string } }, query: unknown, options: { metadata?: unknown }) => {
      const queue = queueFor(channel.guild.id);
      const added = {
        name: new URL(String(query)).pathname.split("/").at(-1) ?? "track",
        url: String(query),
        duration: 180,
        metadata: options.metadata,
      } as Song;
      queue.songs.push(added);
      distube.emit(DTEvents.ADD_SONG, queue, added);
    }),
  }) as unknown as DisTube & EventEmitter & { play: ReturnType<typeof vi.fn> };

  const guild = (guildId: string) => ({
    id: guildId,
    members: {
      me: { voice: { channelId: `voice-${guildId}` } },
      fetch: vi.fn().mockResolvedValue({
        voice: { channel: { id: `voice-${guildId}`, guild: { id: guildId } } },
      }),
    },
  });
  const client = {
    guilds: {
      cache: { get: (guildId: string) => guild(guildId) },
      fetch: vi.fn(async (guildId: string) => guild(guildId)),
    },
    channels: {
      cache: { get: (channelId: string) => ({ id: channelId, isTextBased: () => true, isDMBased: () => false }) },
      fetch: vi.fn(),
    },
  } as unknown as Client;
  const api = { postMusicState: vi.fn().mockResolvedValue(undefined) } as unknown as WorkerApi;
  const controller = new MusicController(client, distube, api, "soundcloud");
  controller.registerEvents();
  return { controller, distube };
}

afterEach(() => {
  ytDlpMocks.json.mockReset();
  vi.restoreAllMocks();
});

describe("MusicController — SoundCloud search latency", () => {
  it("coalesces concurrent identical text searches and serves the next one from cache", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let release!: (value: unknown) => void;
    ytDlpMocks.json.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { controller, distube } = createHarness();

    const first = controller.handle(payload("g1", "Artist Track"));
    const second = controller.handle(payload("g2", "  ÁRTIST — TRACK  "));
    await vi.waitFor(() => expect(ytDlpMocks.json).toHaveBeenCalledOnce());
    release(searchInfo);

    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(ytDlpMocks.json).toHaveBeenCalledOnce();
    expect(ytDlpMocks.json).toHaveBeenCalledWith(
      "scsearch5:Artist Track",
      expect.objectContaining({ dumpSingleJson: true, skipDownload: true, simulate: true }),
    );
    expect((await controller.handle(payload("g1", "artist track"))).ok).toBe(true);
    expect(ytDlpMocks.json).toHaveBeenCalledOnce();
    expect(distube.play).toHaveBeenCalledTimes(3);

    const performanceEvents = log.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((event) => event.event === "music_soundcloud_search_performance");
    expect(performanceEvents.map((event) => event.cacheStatus).sort()).toEqual(["hit", "joined", "miss"]);
    expect(performanceEvents.every((event) => event.cacheMaxEntries === 64 && event.cacheTtlMs === 30_000)).toBe(true);
  });

  it("keeps distinct text searches isolated", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ytDlpMocks.json.mockImplementation(async (query: string) =>
      query.includes("different")
        ? {
            entries: [
              {
                title: "Different Song",
                uploader: "Different",
                duration: 180,
                webpage_url: "https://soundcloud.com/different/song",
              },
            ],
          }
        : searchInfo,
    );
    const { controller } = createHarness();

    await Promise.all([
      controller.handle(payload("g1", "artist track")),
      controller.handle(payload("g2", "different song")),
    ]);

    expect(ytDlpMocks.json).toHaveBeenCalledTimes(2);
    expect(ytDlpMocks.json.mock.calls.map(([query]) => query).sort()).toEqual([
      "scsearch5:artist track",
      "scsearch5:different song",
    ]);
  });

  it("never routes direct SoundCloud tracks or sets through the text-search cache", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { controller, distube } = createHarness();
    const direct = "https://soundcloud.com/artist/direct-track";
    const set = "https://soundcloud.com/artist/sets/album";

    expect((await controller.handle(payload("g1", direct))).ok).toBe(true);
    expect((await controller.handle(payload("g2", set))).ok).toBe(true);

    expect(ytDlpMocks.json).not.toHaveBeenCalled();
    expect(distube.play.mock.calls.map((call) => call[1])).toEqual([direct, set]);
    expect(
      log.mock.calls.some(([line]) => String(line).includes("music_soundcloud_search_performance")),
    ).toBe(false);
  });
});
