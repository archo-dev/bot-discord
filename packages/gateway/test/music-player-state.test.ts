import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPlayerStatus } from "@discordjs/voice";
import {
  Events as DTEvents,
  Playlist,
  PluginType,
  type DisTube,
  type Queue,
  type Song,
} from "distube";
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
  guildId?: string;
  status?: AudioPlayerStatus;
  queuePaused?: boolean;
  initialSongs?: Song[];
  playlistTracks?: MusicTrack[];
  failedUrls?: Set<string>;
  playlistAddLimit?: number;
  memberVoiceChannelId?: string | null;
}

function createHarness(options: HarnessOptions = {}) {
  const guildId = options.guildId ?? "g1";
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
  const getStreamURL = vi.fn(async () => "https://media.example/lazy-stream");
  const plugin = { type: PluginType.PLAYABLE_EXTRACTOR, getStreamURL };

  const makeQueue = (songs: Song[] = options.initialSongs ?? [], paused = options.queuePaused ?? false): Queue => {
    const q = {
      id: guildId,
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
      seek: vi.fn(async (position: number) => {
        q.currentTime = position;
        return q;
      }),
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
    plugins: [plugin],
    voices: {
      get: vi.fn(() => voice),
      leave: vi.fn(() => {
        player.stop(true);
      }),
    },
    play: vi.fn(async (_channel: unknown, query: unknown) => {
      if (query instanceof Playlist) {
        if (!queue) queue = makeQueue([], false);
        const isFirst = queue.songs.length === 0;
        const addedSongs = query.songs.slice(0, options.playlistAddLimit ?? query.songs.length);
        queue.songs.push(...addedSongs);
        distube.emit(DTEvents.ADD_LIST, queue, query);
        if (isFirst && addedSongs[0]) {
          await getStreamURL(addedSongs[0]);
          player.transition(AudioPlayerStatus.Buffering);
          distube.emit(DTEvents.PLAY_SONG, queue, addedSongs[0]);
        }
        return;
      }
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

  const memberVoiceChannelId = options.memberVoiceChannelId === undefined ? "vc1" : options.memberVoiceChannelId;
  const member = {
    voice: {
      channelId: memberVoiceChannelId,
      channel: memberVoiceChannelId ? { id: memberVoiceChannelId, guild: { id: guildId } } : null,
    },
  };
  const guild = {
    id: guildId,
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

  return {
    controller,
    distube,
    api,
    player,
    voice,
    stream,
    streamOutput,
    getStreamURL,
    getQueue: () => queue,
  };
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

    expect(result.message).toBe("📥 Playlist **Album** chargée (3 pistes).");
    expect(distube.play).toHaveBeenCalledOnce();
    expect(distube.play.mock.calls[0]![1]).toBeInstanceOf(Playlist);
    expect(getQueue()!.songs.map((item) => item.url)).toEqual([current.url, ...tracks.map((item) => item.url)]);
  });

  it("serialises saved-playlist loads and lets the newer operation cancel the pending one", async () => {
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
    expect((await first).ok).toBe(false);
    expect((await first).message).toMatch(/annulé/);
    expect((await second).ok).toBe(true);
    expect(api.getPlaylistTracks).toHaveBeenCalledOnce();
  });

  it("does not insert tracks after stop cancels a pending saved-playlist fetch", async () => {
    const { controller, distube, api, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("Current")],
    });
    let requestSignal: AbortSignal | undefined;
    api.getPlaylistTracks.mockImplementationOnce(
      (_guildId: string, _name: string, signal?: AbortSignal) =>
        new Promise<MusicTrack[]>((_resolve, reject) => {
          requestSignal = signal;
          signal?.addEventListener("abort", () => reject(new Error("aborted saved-playlist request")), { once: true });
        }),
    );

    const loading = controller.handle({ ...playPayload, command: "playlist_load", arg: "Pending" });
    await vi.waitFor(() => expect(api.getPlaylistTracks).toHaveBeenCalledOnce());
    const stopped = await controller.handle({ ...playPayload, command: "stop", arg: null });
    const result = await loading;

    expect(stopped.ok).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/annulé/);
    expect(requestSignal?.aborted).toBe(true);
    expect(distube.play).not.toHaveBeenCalled();
    expect(getQueue()).toBeUndefined();
  });

  it("lets an explicit play command supersede a pending saved-playlist load without late insertion", async () => {
    const current = song("Current");
    const { controller, distube, api, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [current],
    });
    let requestSignal: AbortSignal | undefined;
    api.getPlaylistTracks.mockImplementationOnce(
      (_guildId: string, _name: string, signal?: AbortSignal) =>
        new Promise<MusicTrack[]>((_resolve, reject) => {
          requestSignal = signal;
          signal?.addEventListener("abort", () => reject(new Error("aborted saved-playlist request")), { once: true });
        }),
    );

    const loading = controller.handle({ ...playPayload, command: "playlist_load", arg: "Pending" });
    await vi.waitFor(() => expect(api.getPlaylistTracks).toHaveBeenCalledOnce());
    const playing = controller.handle(playPayload);

    expect((await loading).message).toMatch(/annulé/);
    expect((await playing).ok).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    expect(distube.play).toHaveBeenCalledOnce();
    expect(distube.play.mock.calls[0]![1]).toBe(playPayload.arg);
    expect(getQueue()!.songs.map((item) => item.url)).toEqual([current.url, playPayload.arg]);
  });

  it("counts only playlist tracks that were actually added", async () => {
    const tracks = [track("One"), track("Bad", "not a URL"), track("Three")];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { controller, distube, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("Current")],
      playlistTracks: tracks,
    });

    const result = await controller.handle({ ...playPayload, command: "playlist_load", arg: "Album" });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("📥 Playlist **Album** chargée (2 pistes).");
    expect(distube.play).toHaveBeenCalledOnce();
    expect(getQueue()!.songs.slice(1).map((item) => item.url)).toEqual([tracks[0]!.url, tracks[2]!.url]);
  });

  it("reports the exact queue delta if an otherwise valid playlist is only partially inserted", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { controller, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("Current")],
      playlistTracks: [track("One"), track("Two"), track("Three")],
      playlistAddLimit: 2,
    });

    const result = await controller.handle({ ...playPayload, command: "playlist_load", arg: "Partial insert" });

    expect(result).toMatchObject({ ok: true, message: "📥 Playlist **Partial insert** chargée (2 pistes)." });
    expect(getQueue()!.songs.slice(1).map((item) => item.name)).toEqual(["One", "Two"]);
    const summary = log.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((event) => event.event === "music_lazy_playlist_summary");
    expect(summary).toMatchObject({ validated: 3, added: 2, errors: 1 });
  });

  it("resolves only the first lazy Song when a saved playlist starts an empty queue", async () => {
    const tracks = [track("One"), track("Two"), track("Three")];
    const { controller, distube, player, getQueue, getStreamURL } = createHarness({
      status: AudioPlayerStatus.Idle,
      playlistTracks: tracks,
    });

    const handled = controller.handle({ ...playPayload, command: "playlist_load", arg: "Fresh queue" });
    await vi.waitFor(() => expect(getStreamURL).toHaveBeenCalledOnce());
    const playlist = distube.play.mock.calls[0]![1] as Playlist;
    expect(getStreamURL).toHaveBeenCalledWith(playlist.songs[0]);
    expect(getStreamURL).not.toHaveBeenCalledWith(playlist.songs[1]);
    expect(getStreamURL).not.toHaveBeenCalledWith(playlist.songs[2]);
    expect(player.state.status).toBe(AudioPlayerStatus.Buffering);

    player.transition(AudioPlayerStatus.Playing);
    expect(await handled).toMatchObject({ ok: true, message: "📥 Playlist **Fresh queue** chargée (3 pistes)." });
    expect(getQueue()!.songs.map((item) => item.name)).toEqual(["One", "Two", "Three"]);
  });

  it.each([1, 15, 200])("loads %i saved tracks in one lazy queue operation", async (count) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracks = Array.from({ length: count }, (_, index) => track(`Track ${index + 1}`));
    const current = song("Current");
    const { controller, distube, player, stream, getQueue, getStreamURL } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [current],
      playlistTracks: tracks,
    });
    const playSong = vi.fn();
    distube.on(DTEvents.PLAY_SONG, playSong);

    const result = await controller.handle({ ...playPayload, command: "playlist_load", arg: "Large Album" });

    expect(result).toMatchObject({ ok: true, message: `📥 Playlist **Large Album** chargée (${count} pistes).` });
    expect(distube.play).toHaveBeenCalledOnce();
    expect(getStreamURL).not.toHaveBeenCalled();
    expect(playSong).not.toHaveBeenCalled();
    expect(player.state.status).toBe(AudioPlayerStatus.Playing);
    expect(getQueue()!.voice.stream).toBe(stream);
    expect(getQueue()!.songs[0]).toBe(current);
    expect(getQueue()!.songs.slice(1).map((item) => item.url)).toEqual(tracks.map((item) => item.url));
    const summary = log.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((event) => event.event === "music_lazy_playlist_summary");
    expect(summary).toMatchObject({
      actionId: expect.any(String),
      detected: count,
      validated: count,
      added: count,
      ignored: 0,
      errors: 0,
      truncated: 0,
      queueBefore: 1,
      queueAfter: count + 1,
      maxConcurrentPromises: 0,
      cancelled: false,
    });
    const queueEvents = log.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((event) => event.event === "music_queue_event" && event.eventType === "ADD_LIST");
    expect(queueEvents).toHaveLength(1);
  });

  it("caps a saved playlist at 200 tracks and reports the exact truncated count", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracks = Array.from({ length: 205 }, (_, index) => track(`Track ${index + 1}`));
    const { controller, distube, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("Current")],
      playlistTracks: tracks,
    });

    const result = await controller.handle({ ...playPayload, command: "playlist_load", arg: "Oversized" });

    expect(result).toMatchObject({ ok: true, message: "📥 Playlist **Oversized** chargée (200 pistes)." });
    expect(distube.play).toHaveBeenCalledOnce();
    expect(getQueue()!.songs).toHaveLength(201);
    const summary = log.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((event) => event.event === "music_lazy_playlist_summary");
    expect(summary).toMatchObject({ detected: 205, validated: 200, added: 200, truncated: 5 });
  });

  it("reports an unexpected entry failure without hiding the other valid saved tracks", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = Object.defineProperty({}, "title", {
      get() {
        throw new Error("broken saved title");
      },
    }) as MusicTrack;
    const { controller, api, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("Current")],
    });
    api.getPlaylistTracks.mockResolvedValueOnce([track("One"), broken, track("Three")]);

    const result = await controller.handle({ ...playPayload, command: "playlist_load", arg: "Partial" });

    expect(result).toMatchObject({ ok: true, message: "📥 Playlist **Partial** chargée (2 pistes)." });
    expect(getQueue()!.songs.slice(1).map((item) => item.name)).toEqual(["One", "Three"]);
    const event = errorLog.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === "music_lazy_playlist_entry_error");
    expect(event).toMatchObject({
      errorCount: 1,
      firstError: "broken saved title",
    });
  });

  it("does not resume a paused queue when every saved entry is invalid", async () => {
    const { controller, distube, getQueue } = createHarness({
      status: AudioPlayerStatus.Paused,
      queuePaused: true,
      initialSongs: [song("Current")],
      playlistTracks: [track("Bad", "not a URL")],
    });

    const result = await controller.handle({ ...playPayload, command: "playlist_load", arg: "Invalid" });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Aucune piste/);
    expect(distube.play).not.toHaveBeenCalled();
    expect(getQueue()!.resume).not.toHaveBeenCalled();
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

  it("publishes Buffering then Playing without an empty snapshot between two tracks", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const first = song("First");
    const second = song("Second");
    const { distube, api, player, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [first, second],
    });

    distube.emit(DTEvents.PLAY_SONG, getQueue(), first);
    api.postMusicState.mockClear();

    player.transition(AudioPlayerStatus.Idle);
    distube.emit(DTEvents.FINISH_SONG, getQueue(), first);
    getQueue()!.songs.shift();
    getQueue()!.currentTime = 0;
    expect(api.postMusicState).not.toHaveBeenCalled();

    player.transition(AudioPlayerStatus.Buffering);
    distube.emit(DTEvents.PLAY_SONG, getQueue(), second);

    expect(api.postMusicState).toHaveBeenCalledOnce();
    expect(api.postMusicState).toHaveBeenLastCalledWith(
      "g1",
      expect.objectContaining({
        status: "buffering",
        connected: true,
        paused: false,
        current: expect.objectContaining({ title: "Second" }),
      }),
    );

    player.transition(AudioPlayerStatus.Playing);
    await vi.waitFor(() => expect(api.postMusicState).toHaveBeenCalledTimes(2));

    const states = api.postMusicState.mock.calls.map(([, state]) => state);
    expect(states).not.toContainEqual(expect.objectContaining({ connected: false }));
    expect(states).not.toContainEqual(expect.objectContaining({ current: null, queue: [] }));
    expect(states.at(-1)).toMatchObject({
      status: "playing",
      connected: true,
      paused: false,
      current: expect.objectContaining({ title: "Second" }),
      queue: [],
    });
    expect(states[1]!.sequence).toBeGreaterThan(states[0]!.sequence);
    const transitions = log.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((event) => event.event === "music_player_transition");
    expect(transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ oldState: AudioPlayerStatus.Playing, newState: AudioPlayerStatus.Idle }),
      expect.objectContaining({ oldState: AudioPlayerStatus.Idle, newState: AudioPlayerStatus.Buffering }),
      expect.objectContaining({ oldState: AudioPlayerStatus.Buffering, newState: AudioPlayerStatus.Playing }),
    ]));
    expect(player.listenerCount("stateChange")).toBe(1);
  });

  it("publishes an empty dashboard state for a real queue finish and a fatal DisTube error", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const current = song("Current");
    const { distube, api, player, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [current],
    });

    distube.emit(DTEvents.PLAY_SONG, getQueue(), current);
    api.postMusicState.mockClear();
    player.transition(AudioPlayerStatus.Idle);
    expect(api.postMusicState).not.toHaveBeenCalled();

    getQueue()!.songs = [];
    distube.emit(DTEvents.FINISH, getQueue());
    expect(api.postMusicState).toHaveBeenLastCalledWith(
      "g1",
      expect.objectContaining({ status: "idle", connected: false, current: null, queue: [] }),
    );

    api.postMusicState.mockClear();
    getQueue()!.songs = [current];
    distube.emit(DTEvents.ERROR, new Error("fatal stream failure"), getQueue(), current);
    expect(api.postMusicState).toHaveBeenLastCalledWith(
      "g1",
      expect.objectContaining({ status: "error", connected: false, current: null, queue: [] }),
    );
    expect(errorLog.mock.calls.some(([line]) => String(line).includes("fatal stream failure"))).toBe(true);
  });

  it("keeps dashboard transitions isolated between guilds without adding per-transition listeners", async () => {
    const firstGuild = createHarness({
      guildId: "g1",
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("First A"), song("Second A")],
    });
    const secondGuild = createHarness({
      guildId: "g2",
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [song("First B"), song("Second B")],
    });

    firstGuild.distube.emit(DTEvents.PLAY_SONG, firstGuild.getQueue(), firstGuild.getQueue()!.songs[0]!);
    secondGuild.distube.emit(DTEvents.PLAY_SONG, secondGuild.getQueue(), secondGuild.getQueue()!.songs[0]!);
    firstGuild.api.postMusicState.mockClear();
    secondGuild.api.postMusicState.mockClear();

    firstGuild.player.transition(AudioPlayerStatus.Idle);
    firstGuild.getQueue()!.songs.shift();
    firstGuild.player.transition(AudioPlayerStatus.Buffering);
    firstGuild.distube.emit(DTEvents.PLAY_SONG, firstGuild.getQueue(), firstGuild.getQueue()!.songs[0]!);
    firstGuild.player.transition(AudioPlayerStatus.Playing);

    await vi.waitFor(() => expect(firstGuild.api.postMusicState).toHaveBeenCalledTimes(2));
    expect(firstGuild.api.postMusicState).toHaveBeenLastCalledWith(
      "g1",
      expect.objectContaining({ status: "playing", current: expect.objectContaining({ title: "Second A" }) }),
    );
    expect(secondGuild.api.postMusicState).not.toHaveBeenCalled();
    expect(firstGuild.player.listenerCount("stateChange")).toBe(1);
    expect(secondGuild.player.listenerCount("stateChange")).toBe(1);
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
      "[123456789012345678] [process] spawn: ffmpeg -i https://media.example/audio?signature=STREAM_SECRET&token=TOKEN_SECRET",
    );

    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain('"event":"music_stream_event"');
    expect(output).toContain('"lifecycle":"spawned"');
    expect(output).not.toContain("ffmpeg -i");
    expect(output).not.toContain("media.example");
    expect(output).not.toContain("STREAM_SECRET");
    expect(output).not.toContain("TOKEN_SECRET");
  });

  it("logs explicit SoundCloud preview classification and normal played duration without stream URLs", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const preview = song("KAT (feat. La Rvfleuze)");
    preview.duration = 30;
    preview.metadata = {
      soundcloudPlayback: {
        classification: "preview",
        isPreview: true,
        previewReason: "selected_format_id",
        formatId: "http_mp3_1_0_preview",
        protocol: "http",
        formatNote: null,
        acodec: "mp3",
        abr: 128,
        ext: "mp3",
        extractor: "soundcloud",
        availability: null,
      },
    };
    const { distube, api, player, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [preview],
    });
    getQueue()!.currentTime = 30;

    distube.emit(DTEvents.PLAY_SONG, getQueue(), preview);
    player.transition(AudioPlayerStatus.Buffering);
    expect(api.postMusicState).toHaveBeenLastCalledWith(
      "g1",
      expect.objectContaining({
        status: "buffering",
        seekable: false,
        current: expect.objectContaining({ isPreview: true, previewReason: "selected_format_id" }),
      }),
    );
    distube.emit(DTEvents.FINISH_SONG, getQueue(), preview);

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({
      event: "music_queue_event",
      eventType: "PLAY_SONG",
      title: "KAT (feat. La Rvfleuze)",
      isPreview: true,
      previewReason: "selected_format_id",
      sourceFormat: "http_mp3_1_0_preview",
      sourceProtocol: "http",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      event: "music_queue_event",
      eventType: "FINISH_SONG",
      announcedDuration: 30,
      playedDuration: 30,
      completion: "normal",
      isPreview: true,
    }));
    expect(JSON.stringify(events)).not.toContain("signature=");
    expect(JSON.stringify(events)).not.toContain("token=");
  });

  it("ignores DisTube's [test] ffmpeg bootstrap label instead of resolving it as a guild", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { distube } = createHarness();
    const getQueue = vi.mocked(distube.getQueue);
    getQueue.mockClear();

    expect(() => distube.emit(DTEvents.FFMPEG_DEBUG, "[test] spawn ffmpeg at '/usr/bin/ffmpeg' path")).not.toThrow();

    expect(getQueue).not.toHaveBeenCalledWith("test");
    expect(log.mock.calls.some(([line]) => String(line).includes('"lifecycle":"spawned"'))).toBe(false);
  });

  it("keeps manual pause/resume, skip, stop and disconnect state updates working", async () => {
    const current = song("Current");
    const next = song("Next");
    const { controller, distube, api, player, getStreamURL, getQueue } = createHarness({
      status: AudioPlayerStatus.Playing,
      queuePaused: false,
      initialSongs: [current, next],
    });
    distube.emit(DTEvents.PLAY_SONG, getQueue(), current);
    api.postMusicState.mockClear();

    const paused = await controller.handle({ ...playPayload, command: "pause", arg: null });
    expect(paused).toMatchObject({ ok: true, state: { status: "paused" } });
    expect(player.state.status).toBe(AudioPlayerStatus.Paused);
    expect(api.postMusicState).toHaveBeenLastCalledWith("g1", expect.objectContaining({ status: "paused" }));
    const resumed = await controller.handle({ ...playPayload, command: "resume", arg: null });
    expect(resumed).toMatchObject({ ok: true, state: { status: "buffering" } });
    expect(api.postMusicState).toHaveBeenLastCalledWith("g1", expect.objectContaining({ status: "buffering" }));
    player.transition(AudioPlayerStatus.Playing);
    expect(api.postMusicState).toHaveBeenLastCalledWith("g1", expect.objectContaining({ status: "playing" }));
    expect(getQueue()!.resume).toHaveBeenCalledOnce();
    expect((await controller.handle({ ...playPayload, command: "skip", arg: null })).ok).toBe(true);
    expect(getQueue()!.skip).toHaveBeenCalledOnce();

    distube.emit(DTEvents.DISCONNECT, getQueue());
    expect(api.postMusicState).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ status: "stopped", connected: false }),
    );

    getQueue()!.songs = [current];
    const stopped = await controller.handle({ ...playPayload, command: "stop", arg: null });
    expect(stopped).toMatchObject({ ok: true, state: { status: "stopped", current: null } });
    expect(api.postMusicState).toHaveBeenLastCalledWith(
      "g1",
      expect.objectContaining({ status: "stopped", connected: false }),
    );
    expect(getStreamURL).not.toHaveBeenCalled();
  });

  it.each(["panel", "interaction"] as const)(
    "rejects %s controls outside the bot voice channel without mutating the queue",
    async (source) => {
      const current = song("Current");
      const { controller, getQueue } = createHarness({
        initialSongs: [current],
        memberVoiceChannelId: source === "panel" ? null : "other-vc",
      });
      const result = await controller.handle({ ...playPayload, source, command: "pause", arg: null });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("salon vocal");
      expect(getQueue()!.pause).not.toHaveBeenCalled();
    },
  );

  it("adds an authoritative snapshot only to successful panel responses", async () => {
    const panelHarness = createHarness({ initialSongs: [song("Panel")] });
    const panelResult = await panelHarness.controller.handle({ ...playPayload, command: "pause", arg: null });
    expect(panelResult.state).toMatchObject({ status: "paused", current: { title: "Panel" } });

    const interactionHarness = createHarness({ initialSongs: [song("Discord")] });
    const interactionResult = await interactionHarness.controller.handle({
      ...playPayload,
      source: "interaction",
      command: "pause",
      arg: null,
    });
    expect(interactionResult.state).toBeUndefined();
  });

  it("awaits a panel seek, preserves Paused and publishes the authoritative position", async () => {
    const current = song("Current");
    const { controller, api, getQueue } = createHarness({
      initialSongs: [current],
      queuePaused: true,
      status: AudioPlayerStatus.Paused,
    });
    const result = await controller.handle({ ...playPayload, command: "seek", arg: "90" });
    expect(result).toMatchObject({
      ok: true,
      message: "⏩ Position : 90 s",
      state: {
        status: "paused",
        elapsed: 90,
        current: { title: "Current", url: expect.stringMatching(/^https:\/\/soundcloud\.com\//) },
      },
    });
    expect(JSON.stringify(result.state)).not.toContain("signature=");
    expect(getQueue()!.seek).toHaveBeenCalledWith(90);
    expect(getQueue()!.paused).toBe(true);
    expect(api.postMusicState).toHaveBeenLastCalledWith(
      "g1",
      expect.objectContaining({ status: "paused", elapsed: 90 }),
    );

    const zero = await controller.handle({ ...playPayload, command: "seek", arg: "0" });
    expect(zero).toMatchObject({ ok: true, state: { status: "paused", elapsed: 0 } });
    expect(getQueue()!.seek).toHaveBeenLastCalledWith(0);
  });

  it("drops the cached stream URL and confirms Playing before publishing a live seek", async () => {
    const current = {
      ...song("Current"),
      stream: { playFromSource: true, url: "https://media.example/hls?signature=secret-token" },
    } as unknown as Song;
    const { controller, api, getQueue } = createHarness({
      initialSongs: [current],
      queuePaused: false,
      status: AudioPlayerStatus.Playing,
    });
    const result = await controller.handle({ ...playPayload, command: "seek", arg: "90" });
    expect(result).toMatchObject({
      ok: true,
      message: "⏩ Position : 90 s",
      state: { status: "playing", elapsed: 90, current: { title: "Current" } },
    });
    // The stale (expired) HLS URL must be invalidated so the ffmpeg restart
    // resolves a fresh signed URL instead of replaying the refused one.
    expect((current as unknown as { stream: { url?: string } }).stream.url).toBeUndefined();
    expect(getQueue()!.seek).toHaveBeenCalledWith(90);
    // The signed URL must never leak into the published panel state.
    expect(JSON.stringify(result.state)).not.toContain("signature=");
    expect(api.postMusicState).toHaveBeenLastCalledWith(
      "g1",
      expect.objectContaining({ status: "playing", elapsed: 90 }),
    );
  });

  it.each([
    { label: "live", current: { ...song("Live"), duration: 0, isLive: true } as Song },
    {
      label: "preview",
      current: {
        ...song("Preview"),
        metadata: {
          soundcloudPlayback: {
            classification: "preview",
            isPreview: true,
            previewReason: "selected_format_id",
          },
        },
      } as Song,
    },
  ])("rejects seek for $label tracks before touching DisTube", async ({ current }) => {
    const { controller, getQueue } = createHarness({ initialSongs: [current] });
    const result = await controller.handle({ ...playPayload, command: "seek", arg: "10" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ne permet pas");
    expect(getQueue()!.seek).not.toHaveBeenCalled();
  });
});
