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
  const streamOutput = new EventEmitter();
  const stream = Object.assign(new EventEmitter(), { stream: streamOutput, seekTime: 0 });
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

  return { controller, distube, api, player, voice, stream, streamOutput, getQueue: () => queue };
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
    const warningEvents = warning.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(warningEvents).toContainEqual(
      expect.objectContaining({
        event: "music_stream_event",
        lifecycle: "error",
        errorCode: "ERR_STREAM_PREMATURE_CLOSE",
        intentional: true,
        absorbed: true,
      }),
    );
  });

  it("adds to an already Playing queue without resuming or interrupting it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
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

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({ event: "music_action_start", source: "panel", action: "play" }));
    expect(events).toContainEqual(expect.objectContaining({ event: "music_resolved", resolvedType: "Song" }));
    expect(events).toContainEqual(expect.objectContaining({ event: "music_queue_event", eventType: "ADD_SONG" }));
    expect(events).toContainEqual(
      expect.objectContaining({ event: "music_action_end", outcome: "success", addedTracks: 1 }),
    );
  });

  it("serialises concurrent explicit play commands while resuming a paused queue", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
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

    const actionEnds = log.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((event) => event.event === "music_action_end");
    expect(actionEnds).toHaveLength(2);
    expect(actionEnds).toEqual([
      expect.objectContaining({ addedTracks: 1, detectedTracks: 1 }),
      expect.objectContaining({ addedTracks: 1, detectedTracks: 1 }),
    ]);
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

  it("serialises concurrent saved-playlist loads before fetching their tracks", async () => {
    const { controller, api } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("Current")],
    });
    let releaseFirst!: () => void;
    api.getPlaylistTracks
      .mockImplementationOnce(
        () => new Promise<MusicTrack[]>((resolve) => {
          releaseFirst = () => resolve([track("First")]);
        }),
      )
      .mockResolvedValueOnce([track("Second")]);

    const first = controller.handle({ ...playPayload, command: "playlist_load", arg: "First album" });
    const second = controller.handle({ ...playPayload, command: "playlist_load", arg: "Second album" });
    await vi.waitFor(() => expect(api.getPlaylistTracks).toHaveBeenCalledTimes(1));

    releaseFirst();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(api.getPlaylistTracks).toHaveBeenCalledTimes(2);
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
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
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
    const errorEvents = errorLog.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(errorEvents).toContainEqual(
      expect.objectContaining({
        event: "music_start_timeout",
        timeoutMs: PLAYER_START_TIMEOUT_MS,
        playerState: AudioPlayerStatus.Buffering,
      }),
    );

    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prematureClose = Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
    expect(() => stream.emit("error", prematureClose)).not.toThrow();
    const warningEvents = warning.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(warningEvents).toContainEqual(
      expect.objectContaining({
        event: "music_stream_event",
        errorCode: "ERR_STREAM_PREMATURE_CLOSE",
        intentional: true,
        absorbed: true,
      }),
    );
  });

  it("logs unexpected stream errors and detaches its listener when the stream closes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { controller, player, stream, streamOutput } = createHarness({ status: AudioPlayerStatus.Idle });

    const handled = controller.handle(playPayload);
    await vi.waitFor(() => expect(player.state.status).toBe(AudioPlayerStatus.Buffering));
    player.transition(AudioPlayerStatus.Playing);
    await handled;

    const guardedListenerCount = stream.listenerCount("error");
    expect(guardedListenerCount).toBeGreaterThan(0);

    const prematureClose = Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
    expect(() => stream.emit("error", prematureClose)).not.toThrow();
    expect(() => stream.emit("error", Object.assign(new Error("decoder failed"), { code: "EDECODER" }))).not.toThrow();

    const events = error.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "music_stream_event",
        errorCode: "ERR_STREAM_PREMATURE_CLOSE",
        intentional: false,
        absorbed: false,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "music_stream_event",
        errorCode: "EDECODER",
        intentional: false,
        absorbed: false,
      }),
    );

    streamOutput.emit("close");
    expect(stream.listenerCount("error")).toBe(guardedListenerCount - 1);
  });

  it("logs ffmpeg creation without retaining its command or signed input URL", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { distube } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("Current")],
    });

    distube.emit(
      DTEvents.FFMPEG_DEBUG,
      "[g1] [process] spawn: ffmpeg -i https://media.example/audio?signature=STREAM_SECRET&token=TOKEN_SECRET",
    );

    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain('"event":"music_stream_event"');
    expect(output).toContain('"lifecycle":"spawned"');
    expect(output).not.toContain("ffmpeg -i");
    expect(output).not.toContain("media.example");
    expect(output).not.toContain("STREAM_SECRET");
    expect(output).not.toContain("TOKEN_SECRET");
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
