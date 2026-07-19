import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPlayerStatus } from "@discordjs/voice";
import { Events as DTEvents, type DisTube, type Queue, type Song } from "distube";
import type { Client } from "discord.js";
import type { MusicCommandPayload, MusicTrack } from "@bot/shared";
import { MusicController, PLAYER_START_TIMEOUT_MS } from "../src/music/controller.js";
import type { WorkerApi } from "../src/worker-api.js";

class FakeAudioPlayer extends EventEmitter {
  state: { status: AudioPlayerStatus };

  constructor(status: AudioPlayerStatus) {
    super();
    this.state = { status };
  }

  transition(status: AudioPlayerStatus): void {
    const oldState = this.state;
    const newState = { status };
    this.state = newState;
    this.emit("stateChange", oldState, newState);
    this.emit(status, oldState, newState);
  }

  readonly unpause = vi.fn(() => {
    if (this.state.status === AudioPlayerStatus.Paused || this.state.status === AudioPlayerStatus.AutoPaused) {
      this.transition(AudioPlayerStatus.Buffering);
      return true;
    }
    return false;
  });

  readonly stop = vi.fn(() => {
    this.transition(AudioPlayerStatus.Idle);
    return true;
  });
}

function track(title: string, url = `https://soundcloud.com/example/${title.toLowerCase().replaceAll(" ", "-")}`): MusicTrack {
  return { title, url, duration: 180, thumbnail: null, requestedBy: null };
}

function song(title: string, url = `https://soundcloud.com/example/${title.toLowerCase().replaceAll(" ", "-")}`): Song {
  return {
    id: title,
    name: title,
    url,
    duration: 180,
    formattedDuration: "03:00",
    user: undefined,
  } as unknown as Song;
}

interface HarnessOptions {
  status?: AudioPlayerStatus;
  queuePaused?: boolean;
  initialSongs?: Song[];
  playlistTracks?: MusicTrack[];
  failedUrls?: Set<string>;
}

function createHarness(options: HarnessOptions = {}) {
  const player = new FakeAudioPlayer(options.status ?? AudioPlayerStatus.Playing);
  const stream = new EventEmitter();
  const connection = Object.assign(new EventEmitter(), { state: { status: "ready" } });
  const voice = {
    audioPlayer: player,
    connection,
    stream,
    pausingStream: undefined,
    isDisconnected: false,
    unpause: vi.fn(() => {
      if (player.state.status === AudioPlayerStatus.Paused) player.transition(AudioPlayerStatus.Buffering);
    }),
  };
  let queue: Queue | undefined;

  const makeQueue = (songs: Song[] = options.initialSongs ?? [], paused = options.queuePaused ?? false): Queue => {
    const q = {
      id: "g1",
      songs: [...songs],
      previousSongs: [],
      paused,
      stopped: false,
      voice,
      textChannel: undefined,
      currentTime: 0,
      repeatMode: 0,
      volume: 50,
      voiceChannel: { id: "vc1" },
      resume: vi.fn(async () => {
        q.paused = false;
        voice.unpause();
        return q;
      }),
      pause: vi.fn(async () => {
        q.paused = true;
        player.transition(AudioPlayerStatus.Paused);
        return q;
      }),
      skip: vi.fn(async () => q.songs[1]!),
      stop: vi.fn(async () => {
        q.stopped = true;
        q.songs = [];
        player.stop(true);
        queue = undefined;
      }),
    } as unknown as Queue;
    return q;
  };

  if (options.initialSongs || options.queuePaused !== undefined) queue = makeQueue();

  const distube = Object.assign(new EventEmitter(), {
    getQueue: vi.fn(() => queue),
    voices: {
      get: vi.fn(() => voice),
      leave: vi.fn(() => {
        player.stop(true);
      }),
    },
    play: vi.fn(async (_channel: unknown, query: unknown) => {
      const url = String(query);
      if (options.failedUrls?.has(url)) throw new Error(`failed ${url}`);
      if (!queue) queue = makeQueue([], false);
      const isFirst = queue.songs.length === 0;
      const added = song(url.split("/").pop() ?? "track", url);
      queue.songs.push(added);
      distube.emit(DTEvents.ADD_SONG, queue, added);
      if (isFirst) {
        player.transition(AudioPlayerStatus.Buffering);
        distube.emit(DTEvents.PLAY_SONG, queue, added);
      }
    }),
  }) as unknown as DisTube & EventEmitter & {
    play: ReturnType<typeof vi.fn>;
    voices: { get: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> };
  };

  const member = { voice: { channel: { id: "vc1", guild: { id: "g1" } } } };
  const guild = {
    id: "g1",
    members: {
      me: { voice: { channelId: "vc1", serverMute: false, serverDeaf: false, selfMute: false } },
      fetch: vi.fn().mockResolvedValue(member),
    },
  };
  const textChannel = { id: "t1", isTextBased: () => true, isDMBased: () => false };
  const client = {
    guilds: { cache: { get: () => guild }, fetch: vi.fn().mockResolvedValue(guild) },
    channels: { cache: { get: () => textChannel }, fetch: vi.fn().mockResolvedValue(textChannel) },
  } as unknown as Client;
  const api = {
    postMusicState: vi.fn().mockResolvedValue(undefined),
    getPlaylistTracks: vi.fn().mockResolvedValue(options.playlistTracks ?? null),
  } as unknown as WorkerApi & {
    postMusicState: ReturnType<typeof vi.fn>;
    getPlaylistTracks: ReturnType<typeof vi.fn>;
  };
  const controller = new MusicController(client, distube, api, "soundcloud");
  controller.registerEvents();

  return { controller, distube, api, player, voice, stream, getQueue: () => queue };
}

const playPayload: MusicCommandPayload = {
  command: "play",
  guildId: "g1",
  userId: "u1",
  textChannelId: "t1",
  applicationId: null,
  token: null,
  arg: "https://soundcloud.com/example/new-track",
  source: "panel",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MusicController — real AudioPlayer state", () => {
  it("resumes a paused queue and reports success only after the player reaches Playing", async () => {
    const current = song("Current");
    const { controller, distube, player, getQueue } = createHarness({
      status: AudioPlayerStatus.Paused,
      queuePaused: true,
      initialSongs: [current],
    });

    const handled = controller.handle(playPayload);
    await vi.waitFor(() => expect(distube.play).toHaveBeenCalledOnce());
    expect(getQueue()!.resume).toHaveBeenCalledOnce();
    expect(player.state.status).toBe(AudioPlayerStatus.Buffering);

    let settled = false;
    void handled.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    player.transition(AudioPlayerStatus.Playing);
    const result = await handled;

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Ajouté à la file/);
    expect(getQueue()!.songs[0]).toBe(current);
  });

  it("repairs queue.paused=false with a genuinely Paused AudioPlayer", async () => {
    const { controller, player, voice, getQueue } = createHarness({
      status: AudioPlayerStatus.Paused,
      queuePaused: false,
      initialSongs: [song("Current")],
    });

    const handled = controller.handle(playPayload);
    await vi.waitFor(() => expect(player.state.status).toBe(AudioPlayerStatus.Buffering));
    expect(getQueue()!.resume).not.toHaveBeenCalled();
    expect(voice.unpause).toHaveBeenCalledOnce();

    player.transition(AudioPlayerStatus.Playing);
    expect((await handled).ok).toBe(true);
  });

  it("cleans a stale Paused voice without a Queue before starting a fresh player", async () => {
    const { controller, distube, player, stream } = createHarness({ status: AudioPlayerStatus.Paused });

    const handled = controller.handle(playPayload);
    await vi.waitFor(() => expect(distube.play).toHaveBeenCalledOnce());
    expect(distube.voices.leave).toHaveBeenCalledOnce();
    expect(distube.voices.leave.mock.invocationCallOrder[0]).toBeLessThan(distube.play.mock.invocationCallOrder[0]!);
    expect(player.state.status).toBe(AudioPlayerStatus.Buffering);

    player.transition(AudioPlayerStatus.Playing);
    expect((await handled).ok).toBe(true);

    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prematureClose = Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
    expect(() => stream.emit("error", prematureClose)).not.toThrow();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("intentional cleanup"));
  });

  it("adds to an already Playing queue without resuming or interrupting it", async () => {
    const current = song("Current");
    const { controller, distube, player, voice, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [current],
    });

    const result = await controller.handle(playPayload);

    expect(result.ok).toBe(true);
    expect(distube.play).toHaveBeenCalledOnce();
    expect(getQueue()!.resume).not.toHaveBeenCalled();
    expect(voice.unpause).not.toHaveBeenCalled();
    expect(player.unpause).not.toHaveBeenCalled();
    expect(getQueue()!.songs[0]).toBe(current);
  });

  it("serialises concurrent explicit play commands while resuming a paused queue", async () => {
    const { controller, distube, player } = createHarness({
      status: AudioPlayerStatus.Paused,
      queuePaused: true,
      initialSongs: [song("Current")],
    });

    const first = controller.handle(playPayload);
    const second = controller.handle({ ...playPayload, arg: "https://soundcloud.com/example/second" });
    await vi.waitFor(() => expect(distube.play).toHaveBeenCalledTimes(1));

    player.transition(AudioPlayerStatus.Playing);
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(distube.play).toHaveBeenCalledTimes(2);
  });

  it("resumes a paused queue before loading a saved playlist and preserves track order", async () => {
    const tracks = [track("One"), track("Two"), track("Three")];
    const current = song("Current");
    const { controller, distube, player, getQueue } = createHarness({
      status: AudioPlayerStatus.Paused,
      queuePaused: true,
      initialSongs: [current],
      playlistTracks: tracks,
    });

    const handled = controller.handle({ ...playPayload, command: "playlist_load", arg: "Album" });
    await vi.waitFor(() => expect(distube.play).toHaveBeenCalled());
    expect(getQueue()!.resume).toHaveBeenCalledOnce();
    player.transition(AudioPlayerStatus.Playing);
    const result = await handled;

    expect(result.message).toContain("chargée (3 pistes)");
    expect(getQueue()!.songs.map((item) => item.url)).toEqual([current.url, ...tracks.map((item) => item.url)]);
  });

  it("counts only playlist tracks that were actually added", async () => {
    const tracks = [track("One"), track("Bad"), track("Three")];
    const failedUrls = new Set([tracks[1]!.url]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { controller, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("Current")],
      playlistTracks: tracks,
      failedUrls,
    });

    const result = await controller.handle({ ...playPayload, command: "playlist_load", arg: "Album" });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("chargée (2 pistes)");
    expect(getQueue()!.songs.slice(1).map((item) => item.url)).toEqual([tracks[0]!.url, tracks[2]!.url]);
  });

  it("does not publish playing on playSong alone and cleans up a bounded start timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { controller, api, player, voice, stream } = createHarness({ status: AudioPlayerStatus.Idle });

    const handled = controller.handle(playPayload);
    await vi.advanceTimersByTimeAsync(1);
    expect(player.state.status).toBe(AudioPlayerStatus.Buffering);
    expect(api.postMusicState).not.toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ connected: true, paused: false }),
    );

    await vi.advanceTimersByTimeAsync(PLAYER_START_TIMEOUT_MS + 1);
    const result = await handled;

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/flux audio n’a pas démarré/);
    expect(voice.audioPlayer.stop).toHaveBeenCalled();
    expect(api.postMusicState).toHaveBeenCalledWith("g1", expect.objectContaining({ connected: false }));

    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prematureClose = Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
    expect(() => stream.emit("error", prematureClose)).not.toThrow();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("intentional cleanup"));
  });

  it("keeps manual pause/resume, skip, stop and disconnect state updates working", async () => {
    const current = song("Current");
    const next = song("Next");
    const { controller, distube, api, player, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [current, next],
    });

    expect((await controller.handle({ ...playPayload, command: "pause", arg: null })).ok).toBe(true);
    expect(player.state.status).toBe(AudioPlayerStatus.Paused);
    expect((await controller.handle({ ...playPayload, command: "resume", arg: null })).ok).toBe(true);
    player.transition(AudioPlayerStatus.Playing);
    expect(getQueue()!.resume).toHaveBeenCalledOnce();
    expect((await controller.handle({ ...playPayload, command: "skip", arg: null })).ok).toBe(true);
    expect(getQueue()!.skip).toHaveBeenCalledOnce();

    distube.emit(DTEvents.DISCONNECT, getQueue());
    expect(api.postMusicState).toHaveBeenCalledWith("g1", expect.objectContaining({ connected: false }));

    getQueue()!.songs = [current];
    expect((await controller.handle({ ...playPayload, command: "stop", arg: null })).ok).toBe(true);
  });
});
