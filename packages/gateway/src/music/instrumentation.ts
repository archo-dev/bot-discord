import { createHmac, randomUUID } from "node:crypto";
import type { MusicCommand, MusicCommandPayload } from "@bot/shared";
import { sanitizeMedia } from "./log-sanitize.js";

export type MusicActionSource = "discord" | "panel";
export type MusicResolvedType = "Song" | "Playlist";
export type MusicLogLevel = "info" | "warn" | "error";
export type MusicPerformanceStage =
  | "searchStarted"
  | "searchResolved"
  | "queueAdded"
  | "streamCreated"
  | "ffmpegStarted"
  | "buffering"
  | "playing";

export interface PlaybackSnapshot {
  queueSize: number;
  currentTitle: string | null;
  playerState: string;
}

export interface MusicTraceMetadata {
  musicTrace: {
    actionId: string;
    action: MusicCommand;
    source: MusicActionSource;
    guildKey: string;
  };
}

export interface MusicCorrelation {
  actionId?: string;
  action?: MusicCommand;
  source?: MusicActionSource;
  guildKey: string;
}

export interface MusicActionContext extends MusicCorrelation {
  actionId: string;
  action: MusicCommand;
  source: MusicActionSource;
  guildKey: string;
  guildId: string;
  startedAt: number;
  detectedTracks: number;
  addedTracks: number;
  failedTracks: number;
  queueEventsLogged: number;
  queueEventsSuppressed: number;
  resolutionLogged: boolean;
  performanceStages: Partial<Record<MusicPerformanceStage, number>>;
  soundcloudSearches: number;
  soundcloudSearchYtDlpCalls: number;
  streamsCreated: number;
}

export interface MusicLogSink {
  log(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

export interface LazyPlaylistLogSummary {
  detected: number;
  validated: number;
  added: number;
  ignored: number;
  errors: number;
  truncated: number;
  buildDurationMs: number;
  queueBefore: number;
  queueAfter: number;
  maxConcurrentPromises: number;
  cancelled: boolean;
  cancelReason: string | null;
}

const MAX_TEXT_LENGTH = 240;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 32;
const MAX_DEPTH = 4;
const MAX_QUEUE_EVENTS_PER_ACTION = 25;
const SENSITIVE_KEY = /^(token|secret|sig|signature|cookie|authorization)$/i;
const SENSITIVE_ASSIGNMENT =
  /\b(token|secret|sig|signature|cookie|authorization)\b(\s*[:=]\s*|\s+)(?:bearer\s+)?[^\s|,;]+/gi;

function safeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  return sanitizeMedia(value, maxLength).replace(SENSITIVE_ASSIGNMENT, "$1$2[redacted]");
}

function boundedValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((entry) => boundedValue(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([key, entry]) => [safeText(key, 60), SENSITIVE_KEY.test(key) ? "[redacted]" : boundedValue(entry, depth + 1)]),
    );
  }
  return safeText(value);
}

function requestedFields(arg: string | null): Record<string, unknown> {
  const requested = arg?.trim();
  if (!requested) return {};
  try {
    const url = new URL(requested);
    return { requestedUrl: `${url.protocol}//${url.host}${url.pathname}` };
  } catch {
    return { requestedTitle: requested };
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return safeText(error.code, 80);
  }
  if (error instanceof Error && error.name) return safeText(error.name, 80);
  return "unknown_error";
}

/**
 * Bounded structured logger for music playback. It never owns a queue, Song,
 * stream or Discord object: action contexts contain only scalar diagnostics.
 */
export class MusicInstrumentation {
  private readonly secret: string;

  constructor(
    secret: string = randomUUID(),
    private readonly sink: MusicLogSink = console,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.secret = secret;
  }

  guildKey(guildId: string): string {
    return createHmac("sha256", this.secret)
      .update(`m02:music-guild:${guildId}`)
      .digest("hex")
      .slice(0, 32);
  }

  beginAction(payload: MusicCommandPayload, before: PlaybackSnapshot): MusicActionContext {
    const context: MusicActionContext = {
      actionId: randomUUID(),
      action: payload.command,
      source: payload.source === "interaction" ? "discord" : "panel",
      guildKey: this.guildKey(payload.guildId),
      guildId: payload.guildId,
      startedAt: this.now(),
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
    this.emit("info", "music_action_start", context, {
      ...requestedFields(payload.arg),
      queueBefore: before.queueSize,
      currentBefore: before.currentTitle,
      playerBefore: before.playerState,
    });
    return context;
  }

  endAction(
    context: MusicActionContext,
    after: PlaybackSnapshot,
    outcome: "success" | "user_error" | "error",
    error?: unknown,
  ): void {
    if (outcome !== "success" && context.failedTracks === 0) context.failedTracks = 1;
    if (Object.keys(context.performanceStages).length > 0) {
      const stages = context.performanceStages;
      const duration = (from: number | undefined, to: number | undefined): number | null =>
        from !== undefined && to !== undefined && to >= from ? to - from : null;
      this.emit("info", "music_playback_performance", context, {
        commandToSearchResultMs: duration(context.startedAt, stages.searchResolved),
        searchResultToQueueAddMs: duration(stages.searchResolved, stages.queueAdded),
        commandToQueueAddMs: duration(context.startedAt, stages.queueAdded),
        queueAddToStreamCreateMs: duration(stages.queueAdded, stages.streamCreated),
        streamCreateToFfmpegMs: duration(stages.streamCreated, stages.ffmpegStarted),
        ffmpegToBufferingMs: duration(stages.ffmpegStarted, stages.buffering),
        bufferingToPlayingMs: duration(stages.buffering, stages.playing),
        totalMs: this.now() - context.startedAt,
        soundcloudSearches: context.soundcloudSearches,
        soundcloudSearchYtDlpCalls: context.soundcloudSearchYtDlpCalls,
        streamsCreated: context.streamsCreated,
      });
    }
    this.emit(outcome === "error" ? "error" : outcome === "user_error" ? "warn" : "info", "music_action_end", context, {
      outcome,
      durationMs: this.now() - context.startedAt,
      queueAfter: after.queueSize,
      currentAfter: after.currentTitle,
      playerAfter: after.playerState,
      detectedTracks: context.detectedTracks,
      addedTracks: context.addedTracks,
      failedTracks: context.failedTracks,
      queueEventsSuppressed: context.queueEventsSuppressed,
      ...(error === undefined
        ? {}
        : { errorCode: errorCode(error), errorMessage: error instanceof Error ? error.message : error }),
    });
  }

  metadata(context: MusicActionContext): MusicTraceMetadata {
    return {
      musicTrace: {
        actionId: context.actionId,
        action: context.action,
        source: context.source,
        guildKey: context.guildKey,
      },
    };
  }

  correlationFromMetadata(metadata: unknown, guildId: string): MusicCorrelation {
    const trace = (metadata as Partial<MusicTraceMetadata> | null)?.musicTrace;
    if (
      trace &&
      typeof trace.actionId === "string" &&
      typeof trace.action === "string" &&
      (trace.source === "discord" || trace.source === "panel") &&
      typeof trace.guildKey === "string"
    ) {
      return {
        actionId: trace.actionId,
        action: trace.action as MusicCommand,
        source: trace.source,
        guildKey: trace.guildKey,
      };
    }
    return { guildKey: this.guildKey(guildId) };
  }

  markResolved(context: MusicActionContext, type: MusicResolvedType, detectedTracks: number): void {
    context.detectedTracks = Math.max(context.detectedTracks, detectedTracks);
    if (context.resolutionLogged) return;
    context.resolutionLogged = true;
    this.emit("info", "music_resolved", context, { resolvedType: type, detectedTracks });
  }

  markPerformanceStage(context: MusicActionContext | undefined, stage: MusicPerformanceStage): void {
    if (!context || context.performanceStages[stage] !== undefined) return;
    context.performanceStages[stage] = this.now();
    if (stage === "streamCreated") context.streamsCreated++;
  }

  beginSoundcloudSearch(context: MusicActionContext): void {
    context.soundcloudSearches++;
    this.markPerformanceStage(context, "searchStarted");
  }

  markSoundcloudSearchYtDlpCall(context: MusicActionContext): void {
    context.soundcloudSearchYtDlpCalls++;
  }

  soundcloudSearchPerformance(
    context: MusicActionContext,
    fields: {
      cacheStatus: "hit" | "miss" | "joined" | "error";
      durationMs: number;
      cacheSize: number;
      cacheMaxEntries: number;
      cacheTtlMs: number;
      cacheHits: number;
      cacheMisses: number;
      cacheJoins: number;
      cacheEvictions: number;
      cacheExpirations: number;
      cacheEstimatedMaxTextBytes: number;
      activeResolutions: number;
      queuedResolutions: number;
      maxConcurrentObserved: number;
      outcome: "success" | "error";
    },
  ): void {
    this.markPerformanceStage(context, "searchResolved");
    this.emit(fields.outcome === "success" ? "info" : "error", "music_soundcloud_search_performance", context, fields);
  }

  markAdded(context: MusicActionContext | undefined, addedTracks: number): void {
    if (context) context.addedTracks += Math.max(0, addedTracks);
  }

  markFailed(context: MusicActionContext | undefined, failedTracks = 1): void {
    if (context) context.failedTracks += Math.max(0, failedTracks);
  }

  setAdded(context: MusicActionContext, addedTracks: number): void {
    context.addedTracks = Math.max(0, addedTracks);
  }

  lazyPlaylistSummary(context: MusicActionContext, summary: LazyPlaylistLogSummary): void {
    this.emit(summary.cancelled ? "warn" : "info", "music_lazy_playlist_summary", context, { ...summary });
  }

  lazyPlaylistCancelled(guildId: string, reason: string, correlation?: MusicCorrelation): void {
    this.emit("warn", "music_lazy_playlist_cancelled", correlation ?? { guildKey: this.guildKey(guildId) }, {
      reason,
    });
  }

  queueEvent(
    correlation: MusicCorrelation,
    context: MusicActionContext | undefined,
    eventType: "ADD_SONG" | "ADD_LIST" | "PLAY_SONG" | "FINISH_SONG" | "FINISH" | "DISCONNECT",
    fields: Record<string, unknown>,
  ): void {
    if (context && (eventType === "ADD_SONG" || eventType === "ADD_LIST")) {
      if (context.queueEventsLogged >= MAX_QUEUE_EVENTS_PER_ACTION) {
        context.queueEventsSuppressed++;
        return;
      }
      context.queueEventsLogged++;
    }
    this.emit("info", "music_queue_event", correlation, { eventType, ...fields });
  }

  playerTransition(guildId: string, oldState: string, newState: string, correlation?: MusicCorrelation): void {
    this.emit("info", "music_player_transition", correlation ?? { guildKey: this.guildKey(guildId) }, {
      oldState,
      newState,
    });
  }

  voiceTransition(guildId: string, oldState: string, newState: string, correlation?: MusicCorrelation): void {
    this.emit("info", "music_voice_transition", correlation ?? { guildKey: this.guildKey(guildId) }, {
      oldState,
      newState,
    });
  }

  streamEvent(
    level: MusicLogLevel,
    guildId: string,
    lifecycle: "created" | "spawned" | "closed" | "error",
    correlation: MusicCorrelation | undefined,
    fields: Record<string, unknown> = {},
  ): void {
    this.emit(level, "music_stream_event", correlation ?? { guildKey: this.guildKey(guildId) }, {
      lifecycle,
      ...fields,
    });
  }

  cleanup(
    guildId: string,
    reason: string,
    intentional: boolean,
    correlation?: MusicCorrelation,
  ): void {
    this.emit(intentional ? "info" : "warn", "music_cleanup", correlation ?? { guildKey: this.guildKey(guildId) }, {
      reason,
      intentional,
    });
  }

  timeout(guildId: string, playerState: string, correlation?: MusicCorrelation): void {
    this.emit("error", "music_start_timeout", correlation ?? { guildKey: this.guildKey(guildId) }, {
      timeoutMs: 8_000,
      playerState,
    });
  }

  dashboard(
    guildId: string,
    outcome: "sent" | "error",
    state: {
      connected: boolean;
      paused: boolean;
      currentTitle: string | null;
      elapsed: number;
      queueSize: number;
      playerState: string;
      playbackStatus?: string;
      sequence?: number;
    },
    correlation?: MusicCorrelation,
    error?: unknown,
  ): void {
    this.emit(
      outcome === "sent" ? "info" : "error",
      "music_dashboard_publish",
      correlation ?? { guildKey: this.guildKey(guildId) },
      {
        outcome,
        ...state,
        ...(error === undefined
          ? {}
          : { errorCode: errorCode(error), errorMessage: error instanceof Error ? error.message : error }),
      },
    );
  }

  diagnostic(
    level: MusicLogLevel,
    event: string,
    guildId: string | undefined,
    fields: Record<string, unknown>,
    correlation?: MusicCorrelation,
  ): void {
    this.emit(level, event, correlation ?? { guildKey: guildId ? this.guildKey(guildId) : "unknown" }, fields);
  }

  private emit(
    level: MusicLogLevel,
    event: string,
    correlation: MusicCorrelation,
    fields: Record<string, unknown>,
  ): void {
    const line = JSON.stringify(
      boundedValue({
        timestamp: new Date().toISOString(),
        event,
        ...(correlation.actionId ? { actionId: correlation.actionId } : {}),
        ...(correlation.action ? { action: correlation.action } : {}),
        ...(correlation.source ? { source: correlation.source } : {}),
        guildKey: correlation.guildKey,
        ...fields,
      }),
    );
    if (level === "error") this.sink.error(line);
    else if (level === "warn") this.sink.warn(line);
    else this.sink.log(line);
  }
}
