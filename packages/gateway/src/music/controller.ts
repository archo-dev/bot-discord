/** Musique — contrôleur DisTube : exécution des commandes, events, état → KV (panel). */

import {
  DisTube,
  Events as DTEvents,
  Playlist,
  type DisTubeStream,
  type DisTubeVoice,
  type Queue,
  type Song,
} from "distube";
import { type Client, type GuildTextBasedChannel } from "discord.js";
import { AudioPlayerStatus, entersState, type AudioPlayer, type VoiceConnection } from "@discordjs/voice";
import { json as ytdlpJson } from "@distube/yt-dlp";
import {
  EMPTY_MUSIC_STATE,
  type MusicCommandResult,
  type MusicCommandPayload,
  type MusicEnqueueResultDto,
  type MusicPlaybackStatus,
  type MusicSearchResponseDto,
  type MusicStateDto,
} from "@bot/shared";
import type { WorkerApi } from "../worker-api.js";
import { errMsg } from "../util.js";
import {
  PLAY_TIMEOUT_MS,
  UserError,
  loopLabel,
  resolveSoundcloudSearch,
  toTrack,
  withTimeout,
  type MusicReply,
  type PrimarySource,
} from "./format.js";
import { sanitizeMedia } from "./log-sanitize.js";
import { nowPlayingEmbed, queueEmbed } from "./embeds.js";
import {
  MusicInstrumentation,
  type MusicActionContext,
  type MusicCorrelation,
  type MusicTraceMetadata,
  type PlaybackSnapshot,
} from "./instrumentation.js";
import {
  PlaylistLoader,
  PlaylistLoadCancelledError,
  type LazyPlaylistBuildSummary,
  type PlaylistLoadSession,
} from "./playlist-loader.js";
import {
  SoundcloudSearchCache,
  SoundcloudSearchCacheClearedError,
  SoundcloudSearchCapacityError,
} from "./search-cache.js";
import { getSoundcloudPlaybackMetadata } from "./soundcloud-playback.js";
import { MusicControlService } from "./control-service.js";
import { TrackResolver } from "./track-resolver.js";

interface NowPlaying {
  messageId: string;
  channelId: string;
  songUrl: string;
  interval: NodeJS.Timeout;
}

interface GuardedStreamContext {
  guildId: string;
  correlation: MusicCorrelation;
  errorListener: (error: Error) => void;
  closeListener: () => void;
}

interface MusicExecutionReply extends MusicReply {
  search?: MusicSearchResponseDto;
  enqueue?: MusicEnqueueResultDto;
}

/** Maximum time after extraction for Discord's real AudioPlayer to start. */
export const PLAYER_START_TIMEOUT_MS = 8_000;
const DISCORD_SNOWFLAKE_RE = /^\d{17,20}$/;

function isPausedPlayerStatus(status: AudioPlayerStatus): boolean {
  return status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused;
}

function playbackStatus(status: AudioPlayerStatus | undefined): MusicPlaybackStatus {
  if (status === AudioPlayerStatus.Playing) return "playing";
  if (status === AudioPlayerStatus.Buffering) return "buffering";
  if (status && isPausedPlayerStatus(status)) return "paused";
  return "idle";
}

function streamErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function soundcloudPlaybackFields(song: Song): Record<string, unknown> {
  const playback = getSoundcloudPlaybackMetadata(song.metadata, song.id);
  return {
    previewClassification: playback?.classification ?? "unknown",
    isPreview: playback?.isPreview ?? null,
    previewReason: playback?.previewReason ?? null,
    sourceFormat: playback?.formatId ?? null,
    sourceProtocol: playback?.protocol ?? null,
    sourceCodec: playback?.acodec ?? null,
    sourceAbr: playback?.abr ?? null,
    sourceExt: playback?.ext ?? null,
    sourceExtractor: playback?.extractor ?? song.source ?? null,
    sourceAvailability: playback?.availability ?? null,
  };
}

export class MusicController {
  private readonly nowPlaying = new Map<string, NowPlaying>();

  // --- Diagnostics (M: instrumentation ffmpeg/voice) ------------------------
  /** Rolling ffmpeg stderr tails, isolated and bounded per active guild. */
  private readonly ffmpegTails = new Map<string, string>();
  /** Voice objects whose state we've already hooked (avoids duplicate listeners). */
  private readonly instrumentedPlayers = new WeakSet<AudioPlayer>();
  private readonly instrumentedConnections = new WeakSet<VoiceConnection>();
  /** Streams keep this guard even if DisTube later detaches its own listener. */
  private readonly guardedStreams = new WeakSet<DisTubeStream>();
  /** Premature closes are expected only for streams deliberately cleaned up. */
  private readonly expectedStreamClosures = new WeakSet<DisTubeStream>();
  /** Weak lifecycle records: values never outlive their stream keys. */
  private readonly streamContexts = new WeakMap<DisTubeStream, GuardedStreamContext>();
  /** Shared confirmation for playSong and the command awaiting real playback. */
  private readonly playingConfirmations = new Map<string, Promise<void>>();
  /** Active scalar-only action contexts used to correlate synchronous events. */
  private readonly activeActions = new Map<string, MusicActionContext[]>();
  /** The explicit playback action that currently owns the per-guild lock. */
  private readonly executingPlaybackActions = new Map<string, MusicActionContext>();
  private readonly actionsById = new Map<string, MusicActionContext>();
  private readonly playlistLoader = new PlaylistLoader();
  private readonly controlService: MusicControlService;
  private readonly trackResolver: TrackResolver;
  /** Scalar generations invalidate late panel-search results per guild. */
  private readonly searchGenerations = new Map<string, number>();
  private lastMusicStateSequence = 0;

  constructor(
    private readonly client: Client,
    private readonly distube: DisTube,
    private readonly api: WorkerApi,
    private readonly primarySource: PrimarySource = "youtube",
    private readonly instrumentation = new MusicInstrumentation(),
    private readonly soundcloudSearchCache = new SoundcloudSearchCache(),
  ) {
    this.trackResolver = new TrackResolver(
      this.distube,
      this.primarySource,
      (query, action) => this.resolveSoundcloudTextSearch(query, action),
    );
    this.controlService = new MusicControlService({
      getQueue: (guildId) => this.distube.getQueue(guildId),
      authorize: async (queue, guildId, userId) => {
        const guild = this.client.guilds.cache.get(guildId) ?? (await this.client.guilds.fetch(guildId));
        const member = await guild.members.fetch(userId);
        const memberVoiceId = member.voice.channelId;
        if (!memberVoiceId) throw new UserError("⚠️ Rejoins d'abord un salon vocal.");
        const queueVoiceId = queue.voiceChannel?.id;
        if (queueVoiceId && queueVoiceId !== memberVoiceId) {
          throw new UserError("⚠️ Rejoins le salon vocal du bot pour utiliser ce contrôle.");
        }
      },
      seekTarget: (queue) => {
        const current = queue.songs[0];
        const playback = current ? getSoundcloudPlaybackMetadata(current.metadata, current.id) : undefined;
        const duration = current?.duration ?? 0;
        return {
          duration,
          seekable: Boolean(current && duration > 0 && !current.isLive && playback?.isPreview !== true),
        };
      },
      enter: (guildId, action) => this.executingPlaybackActions.set(guildId, action),
      leave: (guildId, action) => {
        if (this.executingPlaybackActions.get(guildId) === action) this.executingPlaybackActions.delete(guildId);
      },
      prepareStreamCleanup: (queue, guildId, action, reason) =>
        this.markVoiceStreamsForCleanup(queue.voice, guildId, action, reason),
      prepareResume: (queue, guildId, action) => this.guardStream(queue.voice.pausingStream, true, guildId, action),
      publish: (queue, action) => this.pushState(queue, action),
      publishStopped: (guildId, action) => this.pushEmptyState(guildId, action, "stopped"),
      clearNowPlaying: (guildId) => this.clearNowPlaying(guildId),
    });
  }

  /** Entry point for the HTTP /music route. Edits the interaction webhook itself. */
  async handle(payload: MusicCommandPayload): Promise<MusicCommandResult> {
    if (payload.command === "play" || payload.command === "playlist_load") {
      this.cancelPlaylistLoad(payload.guildId, "superseded");
    } else if (payload.command === "stop") {
      this.cancelPlaylistLoad(payload.guildId, "stop");
    }
    const action = this.beginAction(payload);
    const playlistSession = payload.command === "playlist_load"
      ? this.playlistLoader.start(payload.guildId, action.actionId)
      : undefined;
    const searchGeneration = payload.command === "search"
      ? (this.searchGenerations.get(payload.guildId) ?? 0) + 1
      : undefined;
    if (searchGeneration !== undefined) this.searchGenerations.set(payload.guildId, searchGeneration);
    let reply: MusicExecutionReply;
    let ok = true;
    let outcome: "success" | "user_error" | "error" = "success";
    let failure: unknown;
    try {
      reply = await this.run(payload, action, playlistSession, searchGeneration);
    } catch (err) {
      ok = false;
      failure = err;
      if (err instanceof UserError) {
        outcome = "user_error";
        reply = { content: err.message };
      } else {
        outcome = "error";
        this.instrumentation.diagnostic(
          "error",
          "music_action_error",
          payload.guildId,
          { errorMessage: errMsg(err) },
          action,
        );
        reply = { content: "⚠️ Une erreur est survenue avec la musique." };
      }
    } finally {
      if (playlistSession) this.playlistLoader.finish(playlistSession);
      if (searchGeneration !== undefined && this.searchGenerations.get(payload.guildId) === searchGeneration) {
        this.searchGenerations.delete(payload.guildId);
      }
      this.finishAction(action, outcome, failure);
    }
    if (payload.source === "interaction" && payload.applicationId && payload.token) {
      await this.editInteraction(payload.applicationId, payload.token, reply).catch((e) =>
        this.instrumentation.diagnostic(
          "error",
          "music_webhook_edit_error",
          payload.guildId,
          { errorMessage: errMsg(e) },
          action,
        ),
      );
    }
    return {
      ok,
      message: reply.content ?? "OK",
      ...(reply.search ? { search: reply.search } : {}),
      ...(reply.enqueue ? { enqueue: reply.enqueue } : {}),
    };
  }

  private async run(
    payload: MusicCommandPayload,
    action: MusicActionContext,
    playlistSession?: PlaylistLoadSession,
    searchGeneration?: number,
  ): Promise<MusicExecutionReply> {
    const guild = this.client.guilds.cache.get(payload.guildId) ?? (await this.client.guilds.fetch(payload.guildId));

    switch (payload.command) {
      case "play":
      case "playlist_load": {
        return this.controlService.withGuildLock(guild.id, action, async () => {
          const member = await guild.members.fetch(payload.userId);
          const voiceChannel = member.voice.channel;
          if (!voiceChannel) throw new UserError("⚠️ Rejoins d'abord un salon vocal.");
          const textChannel = payload.textChannelId
            ? await this.fetchTextChannel(payload.textChannelId)
            : this.distube.getQueue(guild.id)?.textChannel;
          if (payload.command === "play") {
            const raw = payload.arg?.trim();
            if (!raw) throw new UserError("⚠️ Précise un titre ou un lien.");
            // Routes by primary source: SoundCloud search/URL vs YouTube. May reject
            // a bare playlist, or a YouTube link while SoundCloud is the stand-in.
            const resolved = await this.trackResolver.resolveInput(raw, action);
            await this.reconcilePlayback(guild.id, action);
            const before = this.distube.getQueue(guild.id)?.songs.length ?? 0;
            await this.playWithTimeout(voiceChannel, resolved.playQuery, { member, textChannel }, action);
            const queue = this.distube.getQueue(guild.id);
            if (!queue || queue.songs.length === 0) {
              throw new UserError("⚠️ La résolution n’a ajouté aucune piste exploitable.");
            }
            const srcTag = resolved.source === "soundcloud" ? " · 🟠 via SoundCloud" : "";
            const enqueue = {
              position: before === 0 ? 0 : before,
              addedTracks: Math.max(0, queue.songs.length - before),
              currentTitle: queue.songs[0]?.name ?? null,
            };
            if (before === 0) return { content: `🎵 Lecture : **${queue.songs[0]!.name}**${srcTag}`, enqueue };
            const added = queue.songs[queue.songs.length - 1]!;
            return {
              content: `➕ Ajouté à la file : **${added.name}** (position ${queue.songs.length - 1})${srcTag}`,
              enqueue,
            };
          }
          // playlist_load
          const name = payload.arg?.trim();
          if (!name) throw new UserError("⚠️ Précise le nom de la playlist.");
          if (!playlistSession) throw new Error("Missing saved-playlist load session");
          return this.loadSavedPlaylist(
            guild.id,
            name,
            voiceChannel,
            { member, textChannel },
            action,
            playlistSession,
          );
        });
      }

      case "search": {
        const raw = payload.arg?.trim();
        if (!raw) throw new UserError("⚠️ Précise un titre ou un lien.");
        if (raw.length > 500) throw new UserError("⚠️ Recherche trop longue (500 caractères maximum).");
        await guild.members.fetch(payload.userId);
        const preview = await this.trackResolver.search(raw, action, {
          metadata: this.instrumentation.metadata(action),
        });
        if (searchGeneration === undefined || this.searchGenerations.get(guild.id) !== searchGeneration) {
          throw new UserError("⚠️ Cette recherche a été remplacée par une requête plus récente.");
        }
        this.instrumentation.markResolved(
          action,
          preview.result.type === "playlist" ? "Playlist" : "Song",
          preview.result.playableTrackCount,
        );
        return {
          content: "🔎 Résultat trouvé.",
          search: { results: [preview.result] },
        };
      }

      case "pause":
      case "resume":
      case "skip":
      case "stop":
      case "shuffle":
        return this.controlService.execute(guild.id, payload.userId, { action: payload.command }, action);

      case "loop": {
        const mode = payload.arg?.trim();
        if (mode !== undefined && mode !== "" && mode !== "off" && mode !== "song" && mode !== "queue") {
          throw new UserError("⚠️ Mode de répétition invalide.");
        }
        return this.controlService.execute(
          guild.id,
          payload.userId,
          { action: "repeat", mode: mode === "off" || mode === "song" || mode === "queue" ? mode : null },
          action,
        );
      }

      case "volume": {
        const value = Number(payload.arg);
        if (!Number.isInteger(value) || value < 0 || value > 150) {
          throw new UserError("⚠️ Volume attendu entre 0 et 150.");
        }
        return this.controlService.execute(guild.id, payload.userId, { action: "volume", value }, action);
      }

      case "seek": {
        const position = Number(payload.arg);
        if (!Number.isFinite(position) || position < 0) throw new UserError("⚠️ Position invalide.");
        return this.controlService.execute(guild.id, payload.userId, { action: "seek", position }, action);
      }

      case "remove": {
        const n = Number(payload.arg);
        if (!Number.isInteger(n) || n < 1 || n > 200) throw new UserError("⚠️ Numéro de file invalide.");
        return this.controlService.execute(guild.id, payload.userId, { action: "remove", position: n }, action);
      }

      case "nowplaying": {
        const queue = this.requireQueue(guild.id);
        return { embeds: [nowPlayingEmbed(queue).toJSON()] };
      }

      case "queue": {
        const queue = this.requireQueue(guild.id);
        return { embeds: [queueEmbed(queue).toJSON()] };
      }

      case "playlist_save": {
        const name = payload.arg?.trim();
        if (!name || name.length > 60) throw new UserError("⚠️ Nom de playlist invalide (max 60 caractères).");
        const queue = this.requireQueue(guild.id);
        const tracks = queue.songs.map(toTrack);
        await this.api.savePlaylist(guild.id, { ownerId: payload.userId, name, tracks });
        return { content: `💾 Playlist **${name}** enregistrée (${tracks.length} pistes).` };
      }
    }
  }

  private playbackSnapshot(guildId: string): PlaybackSnapshot {
    const queue = this.distube.getQueue(guildId);
    return {
      queueSize: queue?.songs.length ?? 0,
      currentTitle: queue?.songs[0]?.name ?? null,
      playerState: this.distube.voices.get(guildId)?.audioPlayer.state.status ?? "none",
    };
  }

  private beginAction(payload: MusicCommandPayload): MusicActionContext {
    const action = this.instrumentation.beginAction(payload, this.playbackSnapshot(payload.guildId));
    const stack = this.activeActions.get(payload.guildId) ?? [];
    stack.push(action);
    this.activeActions.set(payload.guildId, stack);
    this.actionsById.set(action.actionId, action);
    return action;
  }

  private finishAction(
    action: MusicActionContext,
    outcome: "success" | "user_error" | "error",
    error?: unknown,
  ): void {
    this.instrumentation.endAction(action, this.playbackSnapshot(action.guildId), outcome, error);
    this.actionsById.delete(action.actionId);
    const stack = this.activeActions.get(action.guildId);
    if (!stack) return;
    const index = stack.lastIndexOf(action);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0) this.activeActions.delete(action.guildId);
  }

  private currentAction(guildId: string): MusicActionContext | undefined {
    return this.executingPlaybackActions.get(guildId) ?? this.activeActions.get(guildId)?.at(-1);
  }

  private actionFromMetadata(metadata: unknown): MusicActionContext | undefined {
    const actionId = (metadata as Partial<MusicTraceMetadata> | null)?.musicTrace?.actionId;
    return typeof actionId === "string" ? this.actionsById.get(actionId) : undefined;
  }

  private correlationFromMetadata(metadata: unknown, guildId: string): MusicCorrelation {
    return this.instrumentation.correlationFromMetadata(metadata, guildId);
  }

  private cancelPlaylistLoad(guildId: string, reason: string): void {
    const correlation = this.currentAction(guildId);
    const cancelled = this.playlistLoader.cancel(guildId, reason);
    if (cancelled) this.instrumentation.lazyPlaylistCancelled(guildId, reason, correlation);
  }

  private async resolveSoundcloudTextSearch(query: string, action: MusicActionContext): Promise<string> {
    this.instrumentation.beginSoundcloudSearch(action);
    const startedAt = performance.now();
    try {
      const result = await this.soundcloudSearchCache.resolve(query, () => {
        this.instrumentation.markSoundcloudSearchYtDlpCall(action);
        return resolveSoundcloudSearch(
          query,
          (searchQuery) =>
            ytdlpJson(searchQuery, {
              dumpSingleJson: true,
              noWarnings: true,
              skipDownload: true,
              simulate: true,
              ignoreErrors: true,
            }),
          undefined,
          {
            actionId: action.actionId,
            action: action.action,
            source: action.source,
            guildKey: action.guildKey,
          },
        );
      });
      const snapshot = this.soundcloudSearchCache.snapshot();
      this.instrumentation.soundcloudSearchPerformance(action, {
        cacheStatus: result.status,
        durationMs: result.durationMs,
        cacheSize: snapshot.size,
        cacheMaxEntries: snapshot.maxEntries,
        cacheTtlMs: snapshot.ttlMs,
        cacheHits: snapshot.hits,
        cacheMisses: snapshot.misses,
        cacheJoins: snapshot.joins,
        cacheEvictions: snapshot.evictions,
        cacheExpirations: snapshot.expirations,
        cacheEstimatedMaxTextBytes: snapshot.maxEntries * (64 + 512) * 2,
        activeResolutions: snapshot.activeResolutions,
        queuedResolutions: snapshot.queuedResolutions,
        maxConcurrentObserved: snapshot.maxConcurrentObserved,
        outcome: "success",
      });
      return result.value;
    } catch (error) {
      const snapshot = this.soundcloudSearchCache.snapshot();
      this.instrumentation.soundcloudSearchPerformance(action, {
        cacheStatus: "error",
        durationMs: performance.now() - startedAt,
        cacheSize: snapshot.size,
        cacheMaxEntries: snapshot.maxEntries,
        cacheTtlMs: snapshot.ttlMs,
        cacheHits: snapshot.hits,
        cacheMisses: snapshot.misses,
        cacheJoins: snapshot.joins,
        cacheEvictions: snapshot.evictions,
        cacheExpirations: snapshot.expirations,
        cacheEstimatedMaxTextBytes: snapshot.maxEntries * (64 + 512) * 2,
        activeResolutions: snapshot.activeResolutions,
        queuedResolutions: snapshot.queuedResolutions,
        maxConcurrentObserved: snapshot.maxConcurrentObserved,
        outcome: "error",
      });
      if (error instanceof SoundcloudSearchCapacityError || error instanceof SoundcloudSearchCacheClearedError) {
        throw new UserError("⚠️ Trop de recherches SoundCloud simultanées. Réessaie dans quelques instants.");
      }
      throw error;
    }
  }

  private async loadSavedPlaylist(
    guildId: string,
    name: string,
    voiceChannel: Parameters<DisTube["play"]>[0],
    options: NonNullable<Parameters<DisTube["play"]>[2]>,
    action: MusicActionContext,
    session: PlaylistLoadSession,
  ): Promise<MusicReply> {
    const queueAtStart = this.distube.getQueue(guildId);
    const queueBefore = queueAtStart?.songs.length ?? 0;
    let playlist: Playlist<MusicTraceMetadata> | null = null;
    let buildSummary: LazyPlaylistBuildSummary = {
      detected: 0,
      validated: 0,
      ignored: 0,
      errors: 0,
      truncated: 0,
      buildDurationMs: 0,
      firstError: null,
      maxConcurrentPromises: 0,
    };

    try {
      this.playlistLoader.assertActive(session);
      const tracks = await this.api.getPlaylistTracks(guildId, name, session.signal);
      this.playlistLoader.assertActive(session);
      if (!tracks || tracks.length === 0) {
        throw new UserError(`⚠️ Playlist **${name}** introuvable ou vide.`);
      }

      action.detectedTracks = tracks.length;
      const built = this.playlistLoader.build(session, tracks, {
        name,
        primarySource: this.primarySource,
        plugins: this.distube.plugins,
        member: options.member,
        metadata: this.instrumentation.metadata(action),
      });
      playlist = built.playlist;
      buildSummary = built.summary;
      this.instrumentation.markFailed(action, buildSummary.errors);
      if (buildSummary.firstError) {
        this.instrumentation.diagnostic(
          "error",
          "music_lazy_playlist_entry_error",
          guildId,
          { errorCount: buildSummary.errors, firstError: buildSummary.firstError },
          action,
        );
      }
      if (!playlist) {
        throw new UserError(`⚠️ Aucune piste de la playlist **${name}** n’a pu être ajoutée.`);
      }

      if (queueAtStart && this.distube.getQueue(guildId) !== queueAtStart) {
        this.cancelPlaylistLoad(guildId, "queue_replaced");
        this.playlistLoader.assertActive(session);
      }

      await this.reconcilePlayback(guildId, action);
      this.playlistLoader.assertActive(session);
      try {
        await this.playWithTimeout(
          voiceChannel,
          playlist,
          options,
          action,
          () => this.rollbackLazyPlaylist(guildId, playlist!, action, "late_resolution"),
        );
      } catch (error) {
        buildSummary.errors += buildSummary.validated;
        if (buildSummary.validated > 1) this.instrumentation.markFailed(action, buildSummary.validated - 1);
        await this.rollbackLazyPlaylist(guildId, playlist, action, "play_error");
        throw error;
      }

      if (!this.playlistLoader.isActive(session)) {
        await this.rollbackLazyPlaylist(guildId, playlist, action, session.cancelReason ?? "cancelled");
        this.playlistLoader.assertActive(session);
      }

      const queue = this.distube.getQueue(guildId);
      const addedCount = queue ? playlist.songs.filter((song) => queue.songs.includes(song)).length : 0;
      const missingCount = Math.max(0, buildSummary.validated - addedCount);
      if (missingCount > 0) {
        buildSummary.errors += missingCount;
        this.instrumentation.markFailed(action, missingCount);
      }
      this.instrumentation.setAdded(action, addedCount);
      if (addedCount === 0) {
        throw new UserError(`⚠️ Aucune piste de la playlist **${name}** n’a pu être ajoutée.`);
      }
      return { content: `📥 Playlist **${name}** chargée (${addedCount} pistes).` };
    } catch (error) {
      if (session.cancelled || error instanceof PlaylistLoadCancelledError) {
        throw new UserError("⚠️ Le chargement de la playlist a été annulé.");
      }
      throw error;
    } finally {
      const queue = this.distube.getQueue(guildId);
      const added = playlist ? playlist.songs.filter((song) => queue?.songs.includes(song)).length : 0;
      this.instrumentation.setAdded(action, added);
      this.instrumentation.lazyPlaylistSummary(action, {
        detected: buildSummary.detected,
        validated: buildSummary.validated,
        added,
        ignored: buildSummary.ignored,
        errors: buildSummary.errors,
        truncated: buildSummary.truncated,
        buildDurationMs: buildSummary.buildDurationMs,
        queueBefore,
        queueAfter: queue?.songs.length ?? 0,
        maxConcurrentPromises: buildSummary.maxConcurrentPromises,
        cancelled: session.cancelled,
        cancelReason: session.cancelReason,
      });
      this.playlistLoader.finish(session);
    }
  }

  private async rollbackLazyPlaylist(
    guildId: string,
    playlist: Playlist,
    action: MusicActionContext,
    reason: string,
  ): Promise<void> {
    const queue = this.distube.getQueue(guildId);
    if (!queue) return;
    const lazySongs = new Set(playlist.songs);
    if (!queue.songs.some((song) => lazySongs.has(song))) return;

    if (lazySongs.has(queue.songs[0]!)) {
      this.markVoiceStreamsForCleanup(queue.voice, guildId, action, `lazy_playlist_${reason}`);
      await queue.stop().catch((error) =>
        this.instrumentation.diagnostic(
          "error",
          "music_lazy_playlist_rollback_error",
          guildId,
          { errorMessage: errMsg(error) },
          action,
        ),
      );
      return;
    }

    queue.songs = queue.songs.filter((song) => !lazySongs.has(song));
    this.publishPlayerState(queue, action);
  }

  /**
   * Reconciles DisTube's logical Queue flag with Discord's real AudioPlayer.
   * Explicit /play and /playlist load commands resume a paused queue. A stale
   * paused voice without a queue is destroyed so the next play gets a fresh
   * AudioPlayer instead of replacing streams on an orphaned paused player.
   */
  private async reconcilePlayback(guildId: string, action: MusicActionContext): Promise<void> {
    const queue = this.distube.getQueue(guildId);
    const voice = this.distube.voices.get(guildId);
    if (!voice) return;
    this.guardVoiceStreams(voice, guildId, action);

    const playerStatus = voice.audioPlayer.state.status;
    if (queue) {
      if (queue.paused) {
        this.guardStream(voice.pausingStream, true, guildId, action);
        await queue.resume();
      } else if (isPausedPlayerStatus(playerStatus)) {
        // queue.resume() rejects when queue.paused is already false. The public
        // DisTubeVoice API is the narrowest safe repair for this desync.
        this.guardStream(voice.pausingStream, true, guildId, action);
        voice.unpause();
        if (isPausedPlayerStatus(voice.audioPlayer.state.status)) voice.audioPlayer.unpause();
      }
      return;
    }

    if (isPausedPlayerStatus(playerStatus)) {
      this.markVoiceStreamsForCleanup(voice, guildId, action, "stale_paused_voice");
      this.distube.voices.leave(guildId);
    }
  }

  /** Keeps a targeted error listener attached until the underlying stream closes. */
  private guardStream(
    stream: DisTubeStream | undefined,
    expectedClose = false,
    guildId?: string,
    correlation?: MusicCorrelation,
  ): void {
    if (!stream) return;
    const resolvedGuildId = guildId;
    if (!resolvedGuildId) return;
    const resolvedCorrelation = correlation ?? this.currentAction(resolvedGuildId) ?? {
      guildKey: this.instrumentation.guildKey(resolvedGuildId),
    };
    if (expectedClose) this.expectedStreamClosures.add(stream);

    const existing = this.streamContexts.get(stream);
    if (existing) {
      if (expectedClose) existing.correlation = resolvedCorrelation;
      return;
    }

    this.guardedStreams.add(stream);
    const streamAction = resolvedCorrelation.actionId
      ? this.actionsById.get(resolvedCorrelation.actionId)
      : undefined;
    this.instrumentation.markPerformanceStage(streamAction, "streamCreated");
    let closed = false;
    const closeListener = () => {
      if (closed) return;
      closed = true;
      const intentional = this.expectedStreamClosures.has(stream);
      const eventCorrelation = this.streamContexts.get(stream)?.correlation ?? resolvedCorrelation;
      stream.off("error", errorListener);
      stream.stream.off("close", closeListener);
      this.instrumentation.streamEvent("info", resolvedGuildId, "closed", eventCorrelation, { intentional });
      this.expectedStreamClosures.delete(stream);
      this.guardedStreams.delete(stream);
      this.streamContexts.delete(stream);
    };
    const errorListener = (error: Error) => {
      const code = streamErrorCode(error);
      const intentional = this.expectedStreamClosures.has(stream);
      const eventCorrelation = this.streamContexts.get(stream)?.correlation ?? resolvedCorrelation;
      if (code === "ERR_STREAM_PREMATURE_CLOSE" && intentional) {
        this.instrumentation.streamEvent("warn", resolvedGuildId, "error", eventCorrelation, {
          errorCode: code,
          intentional: true,
          absorbed: true,
        });
        return;
      }
      this.instrumentation.streamEvent("error", resolvedGuildId, "error", eventCorrelation, {
        errorCode: code ?? "stream_error",
        errorMessage: errMsg(error),
        intentional,
        absorbed: false,
      });
    };
    this.streamContexts.set(stream, { guildId: resolvedGuildId, correlation: resolvedCorrelation, errorListener, closeListener });
    stream.on("error", errorListener);
    stream.stream.once("close", closeListener);
    this.instrumentation.streamEvent("info", resolvedGuildId, "created", resolvedCorrelation, {
      intentionalCleanupPending: expectedClose,
      seekTime: stream.seekTime,
    });
    if (stream.stream.destroyed) closeListener();
  }

  private guardVoiceStreams(voice: DisTubeVoice, guildId: string, correlation?: MusicCorrelation): void {
    this.guardStream(voice.stream, false, guildId, correlation);
    this.guardStream(voice.pausingStream, false, guildId, correlation);
  }

  private markVoiceStreamsForCleanup(
    voice: DisTubeVoice,
    guildId: string,
    correlation: MusicCorrelation | undefined,
    reason: string,
  ): void {
    this.instrumentation.cleanup(guildId, reason, true, correlation);
    this.guardStream(voice.stream, true, guildId, correlation);
    this.guardStream(voice.pausingStream, true, guildId, correlation);
  }

  /** Removes a start attempt that never reached the real Playing state. */
  private async cleanupBlockedPlayback(guildId: string, correlation?: MusicCorrelation): Promise<void> {
    this.cancelPlaylistLoad(guildId, "blocked_playback");
    const queue = this.distube.getQueue(guildId);
    const voice = this.distube.voices.get(guildId);
    if (voice) this.markVoiceStreamsForCleanup(voice, guildId, correlation, "blocked_playback");
    else this.instrumentation.cleanup(guildId, "blocked_playback", true, correlation);
    await queue?.stop().catch((error) =>
      this.instrumentation.diagnostic(
        "error",
        "music_cleanup_error",
        guildId,
        { errorMessage: sanitizeMedia(errMsg(error), 300) },
        correlation,
      ),
    );
    if (this.distube.voices.get(guildId)) this.distube.voices.leave(guildId);
    this.clearNowPlaying(guildId);
    this.pushEmptyState(guildId, correlation, "error");
  }

  /** Waits for Discord's actual AudioPlayer, shared by playSong and the command. */
  private confirmPlaying(guildId: string): Promise<void> {
    const pending = this.playingConfirmations.get(guildId);
    if (pending) return pending;
    const confirmation = (async () => {
      const voice = this.distube.voices.get(guildId);
      if (!voice) throw new UserError("⚠️ La connexion vocale n’a pas pu être créée.");
      const action = this.currentAction(guildId);
      this.guardVoiceStreams(voice, guildId, action);
      try {
        await entersState(voice.audioPlayer, AudioPlayerStatus.Playing, PLAYER_START_TIMEOUT_MS);
      } catch {
        const status = voice.audioPlayer.state.status;
        this.instrumentation.timeout(guildId, status, action);
        await this.cleanupBlockedPlayback(guildId, action);
        throw new UserError("⏱️ Le flux audio n’a pas démarré. Réessaie dans quelques instants.");
      }
    })().finally(() => {
      if (this.playingConfirmations.get(guildId) === confirmation) this.playingConfirmations.delete(guildId);
    });
    this.playingConfirmations.set(guildId, confirmation);
    return confirmation;
  }

  /** distube.play() bounded by PLAY_TIMEOUT_MS so a stuck extraction can't
   *  hang the interaction indefinitely. A second short bound confirms that the
   *  real Discord AudioPlayer reached Playing before reporting success. */
  private async playWithTimeout(
    voiceChannel: Parameters<DisTube["play"]>[0],
    query: Parameters<DisTube["play"]>[1],
    options: Parameters<DisTube["play"]>[2],
    action: MusicActionContext,
    onLateResolve?: () => Promise<void> | void,
  ): Promise<void> {
    const guildId = voiceChannel.guild.id;
    const tracedOptions = {
      ...options,
      metadata: this.instrumentation.metadata(action),
    } as Parameters<DisTube["play"]>[2];
    const playPromise = this.distube.play(voiceChannel, query, tracedOptions);
    try {
      await withTimeout(
        playPromise,
        PLAY_TIMEOUT_MS,
        () => new UserError("⏱️ La résolution du morceau a mis trop de temps. Réessaie avec un lien direct."),
      );
    } catch (error) {
      if (onLateResolve) {
        void playPromise
          .then(onLateResolve, () => undefined)
          .catch((lateError) =>
            this.instrumentation.diagnostic(
              "error",
              "music_lazy_playlist_late_cleanup_error",
              guildId,
              { errorMessage: errMsg(lateError) },
              action,
            ),
          );
      }
      this.instrumentation.markFailed(action);
      // A failed addition must not interrupt an already Playing current song.
      // A half-created non-playing queue, however, must not survive the timeout.
      const status = this.distube.voices.get(guildId)?.audioPlayer.state.status;
      if (status !== AudioPlayerStatus.Playing) await this.cleanupBlockedPlayback(guildId, action);
      throw error;
    }
    this.instrumentVoice(guildId);
    const voice = this.distube.voices.get(guildId);
    if (voice) this.guardVoiceStreams(voice, guildId, action);
    await this.confirmPlaying(guildId);
  }

  // --- DisTube events -------------------------------------------------------

  registerEvents(): void {
    this.distube.on(DTEvents.PLAY_SONG, (queue, song) => void this.onPlaySong(queue, song));
    this.distube.on(DTEvents.ADD_SONG, (queue, song) => {
      const action = this.actionFromMetadata(song.metadata) ?? this.currentAction(queue.id);
      const correlation = action ?? this.correlationFromMetadata(song.metadata, queue.id);
      if (action) {
        this.instrumentation.markResolved(action, "Song", 1);
        this.instrumentation.markAdded(action, 1);
        this.instrumentation.markPerformanceStage(action, "queueAdded");
      }
      this.instrumentation.queueEvent(correlation, action, "ADD_SONG", {
        title: song.name,
        duration: song.duration,
        queueSize: queue.songs.length,
      });
      this.publishPlayerState(queue, correlation);
    });
    this.distube.on(DTEvents.ADD_LIST, (queue, playlist) => {
      const action = this.actionFromMetadata(playlist.metadata) ?? this.currentAction(queue.id);
      const correlation = action ?? this.correlationFromMetadata(playlist.metadata, queue.id);
      if (action) {
        this.instrumentation.markResolved(action, "Playlist", playlist.songs.length);
        this.instrumentation.markAdded(action, playlist.songs.length);
        this.instrumentation.markPerformanceStage(action, "queueAdded");
      }
      this.instrumentation.queueEvent(correlation, action, "ADD_LIST", {
        title: playlist.name,
        detectedTracks: playlist.songs.length,
        queueSize: queue.songs.length,
        firstTitle: playlist.songs[0]?.name ?? null,
        previewTracks: playlist.songs.filter(
          (song) => getSoundcloudPlaybackMetadata(song.metadata, song.id)?.isPreview,
        ).length,
        fullTracks: playlist.songs.filter(
          (song) => getSoundcloudPlaybackMetadata(song.metadata, song.id)?.classification === "full",
        ).length,
        unknownPreviewTracks: playlist.songs.filter(
          (song) => !getSoundcloudPlaybackMetadata(song.metadata, song.id) ||
            getSoundcloudPlaybackMetadata(song.metadata, song.id)?.classification === "unknown",
        ).length,
      });
      this.publishPlayerState(queue, correlation);
    });
    this.distube.on(DTEvents.FINISH, (queue) => {
      this.cancelPlaylistLoad(queue.id, "queue_finished");
      const correlation = this.correlationFromMetadata(queue.songs[0]?.metadata, queue.id);
      this.instrumentation.queueEvent(correlation, undefined, "FINISH", { queueSize: queue.songs.length });
      this.ffmpegTails.delete(queue.id);
      this.clearNowPlaying(queue.id);
      this.pushEmptyState(queue.id, correlation, "idle");
    });
    this.distube.on(DTEvents.DISCONNECT, (queue) => {
      this.cancelPlaylistLoad(queue.id, "disconnect");
      const correlation = this.correlationFromMetadata(queue.songs[0]?.metadata, queue.id);
      this.instrumentation.queueEvent(correlation, undefined, "DISCONNECT", { queueSize: queue.songs.length });
      this.ffmpegTails.delete(queue.id);
      this.clearNowPlaying(queue.id);
      this.pushEmptyState(queue.id, correlation, "stopped");
    });
    // DisTube prefixes ffmpeg diagnostics with [guildId]. Spawn commands are
    // deliberately never retained because they contain the signed input URL.
    this.distube.on(DTEvents.FFMPEG_DEBUG, (debug) => {
      const matched = /^\[([^\]]+)]\s*(.*)$/s.exec(debug);
      if (!matched) return;
      const guildId = matched[1]!;
      const detail = matched[2]!;
      // checkFFmpeg() emits bootstrap diagnostics prefixed with `[test]`.
      // Only live queue diagnostics carry a Discord guild snowflake.
      if (!DISCORD_SNOWFLAKE_RE.test(guildId)) return;
      const current = this.distube.getQueue(guildId)?.songs[0];
      const correlation = current
        ? this.correlationFromMetadata(current.metadata, guildId)
        : this.currentAction(guildId);
      if (detail.startsWith("[process] spawn:")) {
        const action = current ? this.actionFromMetadata(current.metadata) : this.currentAction(guildId);
        this.instrumentation.markPerformanceStage(action, "streamCreated");
        this.instrumentation.markPerformanceStage(action, "ffmpegStarted");
        this.instrumentation.streamEvent("info", guildId, "spawned", correlation, {});
        return;
      }
      if (!this.ffmpegTails.has(guildId) && this.ffmpegTails.size >= 100) {
        this.ffmpegTails.delete(this.ffmpegTails.keys().next().value!);
      }
      this.ffmpegTails.set(guildId, `${this.ffmpegTails.get(guildId) ?? ""}\n${detail}`.slice(-4000));
    });
    this.distube.on(DTEvents.FINISH_SONG, (queue, song) => {
      const correlation = this.correlationFromMetadata(song.metadata, queue.id);
      this.instrumentation.queueEvent(correlation, undefined, "FINISH_SONG", {
        title: song.name,
        duration: song.duration,
        announcedDuration: song.duration,
        playedDuration: Math.round(queue.currentTime * 1_000) / 1_000,
        completion: "normal",
        queueSize: queue.songs.length,
        ...soundcloudPlaybackFields(song),
      });
    });
    // NB: DisTube v5.2.3 has no `empty` event — the closest lifecycle signals
    // are DISCONNECT (above) and FINISH.
    this.distube.on(DTEvents.ERROR, (error, queue, song) => {
      const message = errMsg(error);
      const guildId = queue?.id;
      const correlation = guildId
        ? this.correlationFromMetadata(song?.metadata ?? queue?.songs[0]?.metadata, guildId)
        : undefined;
      const code = /code (\d+)/.exec(String(message))?.[1];
      const action = song ? this.actionFromMetadata(song.metadata) : guildId ? this.currentAction(guildId) : undefined;
      this.instrumentation.markFailed(action);
      this.instrumentation.diagnostic("error", "music_distube_error", guildId, {
        errorMessage: message,
        ffmpegExitCode: code ?? null,
        title: song?.name ?? null,
        duration: song?.duration ?? null,
        ffmpegTail: guildId ? sanitizeMedia(this.ffmpegTails.get(guildId) ?? "", 1000) : "",
      }, correlation);
      if (guildId) {
        this.cancelPlaylistLoad(guildId, "distube_error");
        this.instrumentation.cleanup(guildId, "distube_error", false, correlation);
        this.ffmpegTails.delete(guildId);
        this.pushEmptyState(guildId, correlation, "error");
      }
    });
  }

  /**
   * Attaches @discordjs/voice state listeners for a guild's voice — once per
   * underlying AudioPlayer / VoiceConnection object (WeakSet-guarded, so a
   * reconnect that creates fresh objects is re-hooked, and GC'd ones drop out).
   */
  private instrumentVoice(guildId: string): void {
    const voice = this.distube.voices.get(guildId);
    if (!voice) return;

    const player = voice.audioPlayer;
    if (player && !this.instrumentedPlayers.has(player)) {
      this.instrumentedPlayers.add(player);
      player.on("stateChange", (oldState, newState) => {
        const current = this.distube.getQueue(guildId)?.songs[0];
        const correlation = this.currentAction(guildId) ??
          (current ? this.correlationFromMetadata(current.metadata, guildId) : undefined);
        if (oldState.status !== newState.status) {
          this.instrumentation.playerTransition(guildId, oldState.status, newState.status, correlation);
        }
        const action = correlation?.actionId ? this.actionsById.get(correlation.actionId) : undefined;
        if (newState.status === AudioPlayerStatus.Buffering) {
          this.instrumentation.markPerformanceStage(action, "buffering");
        } else if (newState.status === AudioPlayerStatus.Playing) {
          this.instrumentation.markPerformanceStage(action, "playing");
        }
        const queue = this.distube.getQueue(guildId);
        if (
          newState.status === AudioPlayerStatus.Playing ||
          newState.status === AudioPlayerStatus.Buffering ||
          isPausedPlayerStatus(newState.status)
        ) {
          if (queue) this.pushState(queue, correlation);
        }
        // Idle is the brief gap in DisTube's normal track transition, so it
        // keeps the last stable snapshot. Buffering above publishes the next
        // known song without claiming Playing. Terminal handlers own empties.
      });
      player.on("error", (err) => {
        const correlation = this.currentAction(guildId);
        this.instrumentation.diagnostic("error", "music_player_error", guildId, {
          errorMessage: sanitizeMedia(errMsg(err), 500),
        }, correlation);
        this.pushEmptyState(guildId, correlation, "error");
      });
    }

    const connection = voice.connection;
    if (connection && !this.instrumentedConnections.has(connection)) {
      this.instrumentedConnections.add(connection);
      connection.on("stateChange", (oldState, newState) => {
        const correlation = this.currentAction(guildId);
        if (oldState.status !== newState.status) {
          this.instrumentation.voiceTransition(guildId, oldState.status, newState.status, correlation);
        }
        if (newState.status === "disconnected" || newState.status === "destroyed") {
          this.pushEmptyState(guildId, correlation, "stopped");
        }
      });
      connection.on("error", (err) => {
        const correlation = this.currentAction(guildId);
        this.instrumentation.diagnostic("error", "music_voice_error", guildId, {
          errorMessage: sanitizeMedia(errMsg(err), 500),
        }, correlation);
        this.pushEmptyState(guildId, correlation, "error");
      });
    }
  }

  private async onPlaySong(queue: Queue, song: Song): Promise<void> {
    this.instrumentVoice(queue.id);
    const me = this.client.guilds.cache.get(queue.id)?.members.me?.voice;
    const action = this.actionFromMetadata(song.metadata) ?? this.currentAction(queue.id);
    const correlation = action ?? this.correlationFromMetadata(song.metadata, queue.id);
    this.instrumentation.markPerformanceStage(action, "streamCreated");
    if (this.distube.voices.get(queue.id)?.audioPlayer.state.status === AudioPlayerStatus.Buffering) {
      this.instrumentation.markPerformanceStage(action, "buffering");
    }
    this.instrumentation.queueEvent(correlation, action, "PLAY_SONG", {
      title: song.name,
      duration: song.duration,
      queueSize: queue.songs.length,
      playerState: this.distube.voices.get(queue.id)?.audioPlayer.state.status ?? "none",
      voiceChannelPresent: Boolean(me?.channelId),
      serverMute: me?.serverMute ?? null,
      serverDeaf: me?.serverDeaf ?? null,
      selfMute: me?.selfMute ?? null,
      ...soundcloudPlaybackFields(song),
    });
    this.clearNowPlaying(queue.id);
    try {
      await this.confirmPlaying(queue.id);
    } catch {
      return; // the shared confirmation already cleaned up and logged the failure
    }
    if (this.distube.getQueue(queue.id)?.songs[0] !== song) return;
    const channel = queue.textChannel;
    if (!channel) return;
    try {
      const msg = await channel.send({ embeds: [nowPlayingEmbed(queue).toJSON()] });
      const interval = setInterval(() => {
        const q = this.distube.getQueue(queue.id);
        if (!q || q.songs[0]?.url !== song.url) {
          this.clearNowPlaying(queue.id);
          return;
        }
        this.pushState(q, correlation, false);
        void msg.edit({ embeds: [nowPlayingEmbed(q).toJSON()] }).catch(() => {});
      }, 15_000);
      interval.unref();
      this.nowPlaying.set(queue.id, { messageId: msg.id, channelId: channel.id, songUrl: song.url ?? "", interval });
    } catch (err) {
      this.instrumentation.diagnostic("error", "music_now_playing_message_error", queue.id, {
        errorMessage: errMsg(err),
      }, correlation);
    }
  }

  private clearNowPlaying(guildId: string): void {
    const existing = this.nowPlaying.get(guildId);
    if (existing) {
      clearInterval(existing.interval);
      this.nowPlaying.delete(guildId);
    }
  }

  // --- State → KV (panel) ---------------------------------------------------

  private buildState(queue: Queue): MusicStateDto {
    const [current, ...rest] = queue.songs;
    const playerStatus = this.distube.voices.get(queue.id)?.audioPlayer.state.status;
    const currentTrack = current ? toTrack(current) : null;
    const status = playbackStatus(playerStatus);
    return {
      status,
      connected: true,
      paused: status === "paused",
      seekable: Boolean(
        currentTrack && currentTrack.duration > 0 && !currentTrack.isLive && currentTrack.isPreview !== true,
      ),
      current: currentTrack,
      elapsed: Math.floor(queue.currentTime),
      queue: rest.map(toTrack),
      loop: loopLabel(queue.repeatMode),
      volume: queue.volume,
      voiceChannelId: queue.voiceChannel?.id ?? null,
      sequence: this.nextMusicStateSequence(),
      updatedAt: Date.now(),
    };
  }

  private pushState(queue: Queue, correlation?: MusicCorrelation, logPublication = true): void {
    const state = this.buildState(queue);
    const playerState = this.distube.voices.get(queue.id)?.audioPlayer.state.status ?? "none";
    const resolvedCorrelation = correlation ?? this.currentAction(queue.id) ??
      this.correlationFromMetadata(queue.songs[0]?.metadata, queue.id);
    if (!logPublication) {
      void this.api.postMusicState(queue.id, state).catch(() => {});
      return;
    }
    this.api.postMusicState(queue.id, state).then(
      () => this.instrumentation.dashboard(queue.id, "sent", {
        connected: state.connected,
        paused: state.paused,
        currentTitle: state.current?.title ?? null,
        elapsed: state.elapsed,
        queueSize: state.queue.length,
        playerState,
        playbackStatus: state.status,
        sequence: state.sequence,
      }, resolvedCorrelation),
      (error) => this.instrumentation.dashboard(queue.id, "error", {
        connected: state.connected,
        paused: state.paused,
        currentTitle: state.current?.title ?? null,
        elapsed: state.elapsed,
        queueSize: state.queue.length,
        playerState,
        playbackStatus: state.status,
        sequence: state.sequence,
      }, resolvedCorrelation, error),
    );
  }

  /** Publishes only states backed by the current AudioPlayer state. */
  private publishPlayerState(queue: Queue, correlation?: MusicCorrelation): void {
    const status = this.distube.voices.get(queue.id)?.audioPlayer.state.status;
    if (
      status === AudioPlayerStatus.Playing ||
      status === AudioPlayerStatus.Buffering ||
      isPausedPlayerStatus(status as AudioPlayerStatus)
    ) {
      this.pushState(queue, correlation);
    }
  }

  private pushEmptyState(
    guildId: string,
    correlation?: MusicCorrelation,
    status: Extract<MusicPlaybackStatus, "idle" | "stopped" | "error"> = "idle",
  ): void {
    const state: MusicStateDto = {
      ...EMPTY_MUSIC_STATE,
      status,
      sequence: this.nextMusicStateSequence(),
      updatedAt: Date.now(),
    };
    const playerState = this.distube.voices.get(guildId)?.audioPlayer.state.status ?? "none";
    const resolvedCorrelation = correlation ?? this.currentAction(guildId) ?? {
      guildKey: this.instrumentation.guildKey(guildId),
    };
    this.api.postMusicState(guildId, state).then(
      () => this.instrumentation.dashboard(guildId, "sent", {
        connected: false,
        paused: false,
        currentTitle: null,
        elapsed: 0,
        queueSize: 0,
        playerState,
        playbackStatus: state.status,
        sequence: state.sequence,
      }, resolvedCorrelation),
      (error) => this.instrumentation.dashboard(guildId, "error", {
        connected: false,
        paused: false,
        currentTitle: null,
        elapsed: 0,
        queueSize: 0,
        playerState,
        playbackStatus: state.status,
        sequence: state.sequence,
      }, resolvedCorrelation, error),
    );
  }

  private nextMusicStateSequence(): number {
    this.lastMusicStateSequence = Math.max(Date.now(), this.lastMusicStateSequence + 1);
    return this.lastMusicStateSequence;
  }

  // --- Helpers --------------------------------------------------------------

  private requireQueue(guildId: string): Queue {
    const queue = this.distube.getQueue(guildId);
    if (!queue) throw new UserError("⚠️ Rien n'est en lecture pour le moment.");
    return queue;
  }

  private async fetchTextChannel(channelId: string): Promise<GuildTextBasedChannel> {
    const channel = this.client.channels.cache.get(channelId) ?? (await this.client.channels.fetch(channelId));
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new UserError("⚠️ Salon de texte introuvable.");
    }
    return channel;
  }

  private async editInteraction(applicationId: string, token: string, reply: MusicReply): Promise<void> {
    await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: reply.content ?? "", embeds: reply.embeds ?? [], allowed_mentions: { parse: [] } }),
    });
  }
}
