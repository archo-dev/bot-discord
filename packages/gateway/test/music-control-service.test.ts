import { describe, expect, it, vi } from "vitest";
import { RepeatMode, type Queue, type Song } from "distube";
import type { MusicControlRequest } from "@bot/shared";
import { MusicControlService, type MusicControlHooks } from "../src/music/control-service.js";
import type { MusicActionContext } from "../src/music/instrumentation.js";

function song(name: string): Song {
  return { name, duration: 180, isLive: false } as Song;
}

function queue(id = "guild-1", names = ["Current", "Next", "Third"]): Queue {
  const value = {
    id,
    songs: names.map(song),
    paused: false,
    repeatMode: RepeatMode.DISABLED,
    volume: 50,
    currentTime: 0,
    voice: {},
    pause: vi.fn(async () => {
      value.paused = true;
      return value;
    }),
    resume: vi.fn(async () => {
      value.paused = false;
      return value;
    }),
    skip: vi.fn(async () => value.songs[1]!),
    stop: vi.fn(async () => {
      value.songs = [];
    }),
    shuffle: vi.fn(async () => value),
    seek: vi.fn(async (position: number) => {
      value.currentTime = position;
      return value;
    }),
    setVolume: vi.fn((level: number) => {
      value.volume = level;
      return value;
    }),
    setRepeatMode: vi.fn((mode: RepeatMode) => {
      value.repeatMode = mode;
      return mode;
    }),
  };
  return value as unknown as Queue;
}

function action(source: "discord" | "panel", guildId = "guild-1"): MusicActionContext {
  return {
    actionId: `${source}-${guildId}`,
    action: "pause",
    source,
    guildKey: `key-${guildId}`,
    guildId,
    startedAt: 0,
    detectedTracks: 0,
    addedTracks: 0,
    failedTracks: 0,
    queueEventsLogged: 0,
    queueEventsSuppressed: 0,
    resolutionLogged: false,
    performanceStages: {},
    soundcloudSearches: 0,
    soundcloudSearchYtDlpCalls: 0,
    streamsCreated: 0,
  };
}

function harness(queues = new Map<string, Queue>([["guild-1", queue()]])) {
  const hooks: MusicControlHooks = {
    getQueue: (guildId) => queues.get(guildId),
    authorize: vi.fn().mockResolvedValue(undefined),
    seekTarget: vi.fn((current: Queue) => ({ duration: current.songs[0]?.duration ?? 0, seekable: true })),
    enter: vi.fn(),
    leave: vi.fn(),
    prepareStreamCleanup: vi.fn(),
    prepareResume: vi.fn(),
    publish: vi.fn(),
    publishStopped: vi.fn(),
    clearNowPlaying: vi.fn(),
  };
  return { service: new MusicControlService(hooks), hooks, queues };
}

describe("MusicControlService", () => {
  const requests: MusicControlRequest[] = [
    { action: "pause" },
    { action: "resume" },
    { action: "skip" },
    { action: "stop" },
    { action: "shuffle" },
    { action: "volume", value: 72 },
    { action: "repeat", mode: "queue" },
    { action: "remove", position: 1 },
    { action: "seek", position: 90 },
  ];

  it.each(requests)("applies $action identically for Discord and panel", async (request) => {
    const run = async (source: "discord" | "panel") => {
      const q = queue();
      if (request.action === "resume") q.paused = true;
      const { service, hooks } = harness(new Map([[q.id, q]]));
      const reply = await service.execute(q.id, "user-1", request, action(source));
      return {
        reply,
        paused: q.paused,
        songs: q.songs.map((entry) => entry.name),
        volume: q.volume,
        repeatMode: q.repeatMode,
        cleanup: vi.mocked(hooks.prepareStreamCleanup).mock.calls.map((call) => call[3]),
        published: vi.mocked(hooks.publish).mock.calls.length,
        stopped: vi.mocked(hooks.publishStopped).mock.calls.length,
      };
    };

    expect(await run("panel")).toEqual(await run("discord"));
  });

  it("rejects a missing queue and invalid removal without publishing a false success", async () => {
    const empty = harness(new Map());
    await expect(empty.service.execute("guild-1", "user-1", { action: "pause" }, action("panel"))).rejects.toThrow(
      "Aucune musique",
    );

    const q = queue("guild-1", ["Current"]);
    const current = harness(new Map([[q.id, q]]));
    await expect(current.service.execute(q.id, "user-1", { action: "remove", position: 1 }, action("panel"))).rejects.toThrow(
      "Numéro de file invalide",
    );
    expect(current.hooks.publish).not.toHaveBeenCalled();
  });

  it("serializes simultaneous controls in one guild without a global lock", async () => {
    const { service } = harness();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    const first = service.withGuildLock("guild-1", action("panel"), async () => {
      order.push("g1-start");
      await firstGate;
      order.push("g1-end");
    });
    const second = service.withGuildLock("guild-1", action("discord"), async () => {
      order.push("g1-second");
    });
    const other = service.withGuildLock("guild-2", action("panel", "guild-2"), async () => {
      order.push("g2");
    });

    await vi.waitFor(() => expect(order).toEqual(["g1-start", "g2"]));
    releaseFirst();
    await Promise.all([first, second, other]);
    expect(order).toEqual(["g1-start", "g2", "g1-end", "g1-second"]);
  });

  it("keeps the playing song fixed when shuffling or removing queued songs", async () => {
    const q = queue();
    const first = q.songs[0];
    const { service } = harness(new Map([[q.id, q]]));
    await service.execute(q.id, "user-1", { action: "shuffle" }, action("panel"));
    await service.execute(q.id, "user-1", { action: "remove", position: 1 }, action("panel"));
    expect(q.songs[0]).toBe(first);
  });

  it.each([false, true])("seeks playing and paused queues without changing paused=%s", async (paused) => {
    const q = queue();
    q.paused = paused;
    const { service, hooks } = harness(new Map([[q.id, q]]));
    await service.execute(q.id, "user-1", { action: "seek", position: 0 }, action("panel"));
    await service.execute(q.id, "user-1", { action: "seek", position: 180 }, action("panel"));
    expect(q.seek).toHaveBeenNthCalledWith(1, 0);
    expect(q.seek).toHaveBeenNthCalledWith(2, 180);
    expect(q.paused).toBe(paused);
    expect(hooks.publish).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown duration, live/preview targets and positions beyond the track", async () => {
    const q = queue();
    const current = harness(new Map([[q.id, q]]));
    vi.mocked(current.hooks.seekTarget)
      .mockReturnValueOnce({ duration: 0, seekable: false })
      .mockReturnValueOnce({ duration: 180, seekable: false })
      .mockReturnValue({ duration: 180, seekable: true });
    await expect(current.service.execute(q.id, "user-1", { action: "seek", position: 1 }, action("panel"))).rejects.toThrow("ne permet pas");
    await expect(current.service.execute(q.id, "user-1", { action: "seek", position: 1 }, action("panel"))).rejects.toThrow("ne permet pas");
    await expect(current.service.execute(q.id, "user-1", { action: "seek", position: 181 }, action("panel"))).rejects.toThrow("entre 0 et 180");
    expect(q.seek).not.toHaveBeenCalled();
  });

  it("rejects a concurrent seek and serializes a following stop", async () => {
    const q = queue();
    const current = harness(new Map([[q.id, q]]));
    let release!: () => void;
    vi.mocked(q.seek).mockImplementationOnce(() => new Promise<Queue>((resolve) => {
      release = () => resolve(q);
    }));
    const first = current.service.execute(q.id, "user-1", { action: "seek", position: 30 }, action("panel"));
    await vi.waitFor(() => expect(q.seek).toHaveBeenCalledOnce());
    await expect(current.service.execute(q.id, "user-1", { action: "seek", position: 40 }, action("panel"))).rejects.toThrow("déjà en cours");
    const stop = current.service.execute(q.id, "user-1", { action: "stop" }, action("discord"));
    expect(q.stop).not.toHaveBeenCalled();
    release();
    await first;
    await stop;
    expect(q.stop).toHaveBeenCalledOnce();
  });

  it("reports DisTube failures and a track change instead of publishing a false seek success", async () => {
    const q = queue();
    const current = harness(new Map([[q.id, q]]));
    vi.mocked(q.seek).mockRejectedValueOnce(new Error("ffmpeg seek failed"));
    await expect(current.service.execute(q.id, "user-1", { action: "seek", position: 20 }, action("panel"))).rejects.toThrow("ffmpeg seek failed");
    vi.mocked(q.seek).mockImplementationOnce(async () => {
      q.songs[0] = song("Replacement");
      return q;
    });
    await expect(current.service.execute(q.id, "user-1", { action: "seek", position: 20 }, action("panel"))).rejects.toThrow("piste a changé");
    expect(current.hooks.publish).not.toHaveBeenCalled();
  });
});
