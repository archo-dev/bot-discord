import { describe, expect, it, vi } from "vitest";
import type { MusicCommandPayload } from "@bot/shared";
import {
  MusicInstrumentation,
  type MusicLogSink,
  type PlaybackSnapshot,
} from "../src/music/instrumentation.js";

function createLogger() {
  const lines: string[] = [];
  const sink: MusicLogSink = {
    log: vi.fn((line: string) => lines.push(line)),
    warn: vi.fn((line: string) => lines.push(line)),
    error: vi.fn((line: string) => lines.push(line)),
  };
  let now = 10;
  const logger = new MusicInstrumentation("instrumentation-test-secret", sink, () => now);
  return {
    logger,
    lines,
    sink,
    advance(ms: number) {
      now += ms;
    },
  };
}

const snapshot: PlaybackSnapshot = {
  queueSize: 1,
  currentTitle: "Current",
  playerState: "playing",
};

function payload(source: "interaction" | "panel", arg: string): MusicCommandPayload {
  return {
    command: "play",
    guildId: "1406188083380092989",
    userId: "200000000000000001",
    textChannelId: "300000000000000001",
    applicationId: source === "interaction" ? "app" : null,
    token: source === "interaction" ? "never-log-this-token" : null,
    arg,
    source,
  };
}

describe("MusicInstrumentation", () => {
  it("creates a unique correlated action and maps interaction/panel sources", () => {
    const { logger, lines, advance } = createLogger();
    const discord = logger.beginAction(payload("interaction", "GAZO - RAPPEL"), snapshot);
    const panel = logger.beginAction(payload("panel", "Ninho - Jefe"), snapshot);
    advance(25);
    logger.endAction(discord, { queueSize: 2, currentTitle: "Current", playerState: "playing" }, "success");

    expect(discord.actionId).not.toBe(panel.actionId);
    expect(discord.source).toBe("discord");
    expect(panel.source).toBe("panel");
    expect(discord.guildKey).toHaveLength(32);
    expect(discord.guildKey).not.toContain(discord.guildId);

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events[0]).toMatchObject({
      event: "music_action_start",
      action: "play",
      source: "discord",
      actionId: discord.actionId,
      queueBefore: 1,
      currentBefore: "Current",
      playerBefore: "playing",
    });
    expect(events[2]).toMatchObject({
      event: "music_action_end",
      outcome: "success",
      durationMs: 25,
      queueAfter: 2,
      addedTracks: 0,
      failedTracks: 0,
    });
  });

  it("never logs raw guild IDs, interaction tokens, cookies, signatures or URL query parameters", () => {
    const { logger, lines } = createLogger();
    const context = logger.beginAction(
      payload(
        "interaction",
        "https://soundcloud.com/example/song?signature=SIGNATURE_SECRET&token=TOKEN_SECRET&cookie=COOKIE_SECRET",
      ),
      snapshot,
    );
    logger.diagnostic("error", "music_test_error", context.guildId, {
      token: "DIRECT_TOKEN_SECRET",
      cookie: "DIRECT_COOKIE_SECRET",
      secret: "DIRECT_CONFIG_SECRET",
      errorMessage:
        "Authorization: Bearer AUTH_SECRET Cookie: SID=COOKIE_SECRET https://media.example/audio?sig=STREAM_SECRET",
    }, context);

    const output = lines.join("\n");
    expect(output).not.toContain(context.guildId);
    expect(output).not.toContain("never-log-this-token");
    expect(output).not.toContain("SIGNATURE_SECRET");
    expect(output).not.toContain("TOKEN_SECRET");
    expect(output).not.toContain("COOKIE_SECRET");
    expect(output).not.toContain("AUTH_SECRET");
    expect(output).not.toContain("STREAM_SECRET");
    expect(output).not.toContain("DIRECT_TOKEN_SECRET");
    expect(output).not.toContain("DIRECT_COOKIE_SECRET");
    expect(output).not.toContain("DIRECT_CONFIG_SECRET");
    expect(output).not.toContain("signature=");
    expect(output).toContain("https://soundcloud.com/example/song");
  });

  it("bounds fields and queue-event volume while retaining exact aggregate counts", () => {
    const { logger, lines } = createLogger();
    const context = logger.beginAction(payload("panel", "x".repeat(2_000)), snapshot);
    logger.markResolved(context, "Playlist", 200);
    logger.markAdded(context, 200);
    for (let index = 0; index < 200; index++) {
      logger.queueEvent(context, context, "ADD_SONG", { title: `Track ${index}` });
    }
    logger.endAction(context, { queueSize: 201, currentTitle: "Current", playerState: "playing" }, "success");

    expect(lines.every((line) => line.length < 2_000)).toBe(true);
    const end = JSON.parse(lines.at(-1)!) as Record<string, unknown>;
    expect(end).toMatchObject({
      detectedTracks: 200,
      addedTracks: 200,
      queueEventsSuppressed: 175,
    });
  });

  it("preserves correlation through scalar-only Song metadata", () => {
    const { logger } = createLogger();
    const context = logger.beginAction(payload("panel", "track"), snapshot);
    const metadata = logger.metadata(context);

    expect(logger.correlationFromMetadata(metadata, context.guildId)).toEqual({
      actionId: context.actionId,
      action: "play",
      source: "panel",
      guildKey: context.guildKey,
    });
    expect(metadata).not.toHaveProperty("guildId");
  });

  it("emits bounded playback-stage latency metrics without per-tick logging", () => {
    const { logger, lines, advance } = createLogger();
    const context = logger.beginAction(payload("panel", "artist track"), snapshot);
    logger.beginSoundcloudSearch(context);
    logger.markSoundcloudSearchYtDlpCall(context);
    advance(5);
    logger.soundcloudSearchPerformance(context, {
      cacheStatus: "miss",
      durationMs: 5,
      cacheSize: 1,
      cacheMaxEntries: 64,
      cacheTtlMs: 30_000,
      cacheHits: 0,
      cacheMisses: 1,
      cacheJoins: 0,
      cacheEvictions: 0,
      cacheExpirations: 0,
      cacheEstimatedMaxTextBytes: 73_728,
      activeResolutions: 0,
      queuedResolutions: 0,
      maxConcurrentObserved: 1,
      outcome: "success",
    });
    advance(3);
    logger.markPerformanceStage(context, "queueAdded");
    advance(2);
    logger.markPerformanceStage(context, "streamCreated");
    logger.markPerformanceStage(context, "streamCreated");
    advance(1);
    logger.markPerformanceStage(context, "ffmpegStarted");
    advance(4);
    logger.markPerformanceStage(context, "buffering");
    advance(6);
    logger.markPerformanceStage(context, "playing");
    advance(2);
    logger.endAction(context, snapshot, "success");

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.find((event) => event.event === "music_soundcloud_search_performance")).toMatchObject({
      cacheStatus: "miss",
      cacheMaxEntries: 64,
      cacheTtlMs: 30_000,
      durationMs: 5,
    });
    expect(events.find((event) => event.event === "music_playback_performance")).toMatchObject({
      commandToSearchResultMs: 5,
      searchResultToQueueAddMs: 3,
      commandToQueueAddMs: 8,
      queueAddToStreamCreateMs: 2,
      streamCreateToFfmpegMs: 1,
      ffmpegToBufferingMs: 4,
      bufferingToPlayingMs: 6,
      totalMs: 23,
      soundcloudSearches: 1,
      soundcloudSearchYtDlpCalls: 1,
      streamsCreated: 1,
    });
    expect(events.filter((event) => event.event === "music_playback_performance")).toHaveLength(1);
  });
});
