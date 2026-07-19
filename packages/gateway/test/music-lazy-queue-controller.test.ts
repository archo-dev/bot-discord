import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPlayerStatus } from "@discordjs/voice";
import { Events as DTEvents, Playlist, PluginType, type DisTube, type Queue, type Song } from "distube";
import type { Client } from "discord.js";
import type { MusicCommandPayload, MusicTrack } from "@bot/shared";
import { MusicController } from "../src/music/controller.js";
import type { WorkerApi } from "../src/worker-api.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function savedTracks(guildId: string): MusicTrack[] {
  return Array.from({ length: 200 }, (_, index) => ({
    title: `${guildId} Track ${index + 1}`,
    url: `https://soundcloud.com/${guildId}/track-${index + 1}`,
    duration: 180,
    thumbnail: null,
    requestedBy: null,
  }));
}

function payload(guildId: string, command: "playlist_load" | "stop"): MusicCommandPayload {
  return {
    command,
    guildId,
    userId: `user-${guildId}`,
    textChannelId: `text-${guildId}`,
    applicationId: null,
    token: null,
    arg: command === "playlist_load" ? "Large Album" : null,
    source: "panel",
  };
}

describe("MusicController — lazy playlist guild isolation", () => {
  it("loads two 200-track guilds concurrently and cancels only the requested guild", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const queues = new Map<string, Queue>();
    const voices = new Map<string, { audioPlayer: EventEmitter & { state: { status: AudioPlayerStatus } } }>();

    const makeQueue = (guildId: string): Queue => {
      const player = Object.assign(new EventEmitter(), { state: { status: AudioPlayerStatus.Playing } });
      const voice = {
        audioPlayer: player,
        connection: Object.assign(new EventEmitter(), { state: { status: "ready" } }),
        stream: undefined,
        pausingStream: undefined,
        unpause: vi.fn(),
      };
      voices.set(guildId, voice);
      const current = { name: `${guildId} Current`, url: `https://soundcloud.com/${guildId}/current`, duration: 180 } as Song;
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
        stop: vi.fn(async () => {
          queue.stopped = true;
          queue.songs = [];
          player.state = { status: AudioPlayerStatus.Idle };
          queues.delete(guildId);
        }),
        resume: vi.fn(),
      } as unknown as Queue;
      queues.set(guildId, queue);
      return queue;
    };
    makeQueue("g1");
    makeQueue("g2");

    const plugin = {
      type: PluginType.PLAYABLE_EXTRACTOR,
      getStreamURL: vi.fn(),
    };
    const distube = Object.assign(new EventEmitter(), {
      plugins: [plugin],
      getQueue: vi.fn((guildId: string) => queues.get(guildId)),
      voices: {
        get: vi.fn((guildId: string) => voices.get(guildId)),
        leave: vi.fn(),
      },
      play: vi.fn(async (channel: { guild: { id: string } }, input: unknown) => {
        const queue = queues.get(channel.guild.id);
        if (!queue || !(input instanceof Playlist)) throw new Error("missing queue or playlist");
        queue.songs.push(...input.songs);
        distube.emit(DTEvents.ADD_LIST, queue, input);
      }),
    }) as unknown as DisTube & EventEmitter & { play: ReturnType<typeof vi.fn> };

    const guild = (guildId: string) => ({
      id: guildId,
      members: {
        me: { voice: { channelId: `voice-${guildId}` } },
        fetch: vi.fn().mockResolvedValue({
          voice: {
            channelId: `voice-${guildId}`,
            channel: { id: `voice-${guildId}`, guild: { id: guildId } },
          },
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

    const releases = new Map<string, () => void>();
    const requestSignals = new Map<string, AbortSignal | undefined>();
    const api = {
      postMusicState: vi.fn().mockResolvedValue(undefined),
      getPlaylistTracks: vi.fn(
        (guildId: string, _name: string, signal?: AbortSignal) =>
          new Promise<MusicTrack[]>((resolve, reject) => {
            requestSignals.set(guildId, signal);
            const aborted = () => reject(new Error(`aborted ${guildId}`));
            signal?.addEventListener("abort", aborted, { once: true });
            releases.set(guildId, () => {
              signal?.removeEventListener("abort", aborted);
              resolve(savedTracks(guildId));
            });
          }),
      ),
    } as unknown as WorkerApi;
    const controller = new MusicController(client, distube, api, "soundcloud");
    controller.registerEvents();

    const first = controller.handle(payload("g1", "playlist_load"));
    const second = controller.handle(payload("g2", "playlist_load"));
    await vi.waitFor(() => expect(api.getPlaylistTracks).toHaveBeenCalledTimes(2));

    const stopped = await controller.handle(payload("g1", "stop"));
    releases.get("g2")!();
    const secondResult = await second;
    const firstResult = await first;

    expect(stopped.ok).toBe(true);
    expect(firstResult.ok).toBe(false);
    expect(firstResult.message).toMatch(/annulé/);
    expect(requestSignals.get("g1")?.aborted).toBe(true);
    expect(requestSignals.get("g2")?.aborted).toBe(false);
    expect(secondResult).toMatchObject({ ok: true, message: "📥 Playlist **Large Album** chargée (200 pistes)." });
    expect(queues.has("g1")).toBe(false);
    expect(queues.get("g2")!.songs).toHaveLength(201);
    expect(distube.play).toHaveBeenCalledOnce();
    expect(distube.play.mock.calls[0]![0].guild.id).toBe("g2");
    expect(plugin.getStreamURL).not.toHaveBeenCalled();
  });
});
