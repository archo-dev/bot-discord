/** Musique — contrôleur DisTube : exécution des commandes, events, état → KV (panel). */

import {
  DisTube,
  Events as DTEvents,
  RepeatMode,
  type DisTubeStream,
  type DisTubeVoice,
  type Queue,
  type Song,
} from "distube";
import { type Client, type GuildTextBasedChannel } from "discord.js";
import { AudioPlayerStatus, entersState, type AudioPlayer, type VoiceConnection } from "@discordjs/voice";
import { json as ytdlpJson } from "@distube/yt-dlp";
import { EMPTY_MUSIC_STATE, type MusicCommandPayload, type MusicStateDto } from "@bot/shared";
import type { WorkerApi } from "../worker-api.js";
import { errMsg } from "../util.js";
import {
  PLAY_TIMEOUT_MS,
  UserError,
  formatDuration,
  loopLabel,
  resolvePlayQuery,
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

/** Maximum time after extraction for Discord's real AudioPlayer to start. */
export const PLAYER_START_TIMEOUT_MS = 8_000;

function isPausedPlayerStatus(status: AudioPlayerStatus): boolean {
  return status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused;
}

function streamErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
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
  /** One explicit /play or /playlist load start sequence per guild at a time. */
  private readonly playbackLocks = new Map<string, Promise<void>>();
  /** Shared confirmation for playSong and the command awaiting real playback. */
  private readonly playingConfirmations = new Map<string, Promise<void>>();
  /** Active scalar-only action contexts used to correlate synchronous events. */
  private readonly activeActions = new Map<string, MusicActionContext[]>();
  /** The explicit playback action that currently owns the per-guild lock. */
  private readonly executingPlaybackActions = new Map<string, MusicActionContext>();
  private readonly actionsById = new Map<string, MusicActionContext>();

  constructor(
    private readonly client: Client,
    private readonly distube: DisTube,
    private readonly api: WorkerApi,
    private readonly primarySource: PrimarySource = "youtube",
    private readonly instrumentation = new MusicInstrumentation(),
  ) {}

  /** Entry point for the HTTP /music route. Edits the interaction webhook itself. */
  async handle(payload: MusicCommandPayload): Promise<{ ok: boolean; message: string }> {
    const action = this.beginAction(payload);
    let reply: MusicReply;
    let ok = true;
    let outcome: "success" | "user_error" | "error" = "success";
    let failure: unknown;
    try {
      reply = await this.run(payload, action);
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
    return { ok, message: reply.content ?? "OK" };
  }

  private async run(payload: MusicCommandPayload, action: MusicActionContext): Promise<MusicReply> {
    const guild = this.client.guilds.cache.get(payload.guildId) ?? (await this.client.guilds.fetch(payload.guildId));

    switch (payload.command) {
      case "play":
      case "playlist_load": {
        return this.withPlaybackLock(guild.id, action, async () => {
          const member = await guild.members.fetch(payload.userId);
          const voiceChannel = member.voice.channel;
          if (!voiceChannel) throw new UserError("⚠️ Rejoins d'abord un salon vocal.");
          const textChannel = await this.fetchTextChannel(payload.textChannelId);
          if (payload.command === "play") {
            const raw = payload.arg?.trim();
            if (!raw) throw new UserError("⚠️ Précise un titre ou un lien.");
            // Routes by primary source: SoundCloud search/URL vs YouTube. May reject
            // a bare playlist, or a YouTube link while SoundCloud is the stand-in.
            const resolved = resolvePlayQuery(raw, this.primarySource);
            // DisTube only routes http(s) URLs to the yt-dlp plugin, so a SoundCloud
            // text search is pre-resolved here to a concrete track URL first.
            const playQuery = resolved.soundcloudSearch
              ? await resolveSoundcloudSearch(resolved.query, (q) =>
                  ytdlpJson(q, {
                    dumpSingleJson: true,
                    noWarnings: true,
                    skipDownload: true,
                    simulate: true,
                    // Skip DRM/unavailable entries instead of aborting the whole
                    // scsearch5 — the selector then picks the first playable one.
                    ignoreErrors: true,
                  }),
                undefined,
                {
                  actionId: action.actionId,
                  action: action.action,
                  source: action.source,
                  guildKey: action.guildKey,
                },
              )
              : resolved.query;
            await this.reconcilePlayback(guild.id, action);
            const before = this.distube.getQueue(guild.id)?.songs.length ?? 0;
            await this.playWithTimeout(voiceChannel, playQuery, { member, textChannel }, action);
            const queue = this.distube.getQueue(guild.id);
            if (!queue || queue.songs.length === 0) return { content: "🔎 Recherche lancée…" };
            const srcTag = resolved.source === "soundcloud" ? " · 🟠 via SoundCloud" : "";
            if (before === 0) return { content: `🎵 Lecture : **${queue.songs[0]!.name}**${srcTag}` };
            const added = queue.songs[queue.songs.length - 1]!;
            return { content: `➕ Ajouté à la file : **${added.name}** (position ${queue.songs.length - 1})${srcTag}` };
          }
          // playlist_load
          const name = payload.arg?.trim();
          if (!name) throw new UserError("⚠️ Précise le nom de la playlist.");
          const tracks = await this.api.getPlaylistTracks(guild.id, name);
          if (!tracks || tracks.length === 0) throw new UserError(`⚠️ Playlist **${name}** introuvable ou vide.`);
          action.detectedTracks = tracks.length;
          await this.reconcilePlayback(guild.id, action);
          let addedCount = 0;
          for (const t of tracks) {
            let trackUrl: string;
            try {
              trackUrl = resolvePlayQuery(t.url, this.primarySource).query;
            } catch {
              this.instrumentation.markFailed(action);
              continue; // skip an un-playable saved track (bare playlist, or YT while on SoundCloud)
            }
            const before = this.distube.getQueue(guild.id)?.songs.length ?? 0;
            try {
              await this.playWithTimeout(voiceChannel, trackUrl, { member, textChannel }, action);
              const after = this.distube.getQueue(guild.id)?.songs.length ?? 0;
              addedCount += Math.max(0, after - before);
            } catch (e) {
              this.instrumentation.diagnostic(
                "error",
                "music_playlist_track_error",
                guild.id,
                { errorMessage: errMsg(e) },
                action,
              );
            }
          }
          if (addedCount === 0) {
            throw new UserError(`⚠️ Aucune piste de la playlist **${name}** n’a pu être ajoutée.`);
          }
          return { content: `📥 Playlist **${name}** chargée (${addedCount} pistes).` };
        });
      }

      case "pause": {
        const queue = this.requireQueue(guild.id);
        if (queue.paused) return { content: "⏸️ Déjà en pause." };
        queue.pause();
        this.pushState(queue);
        return { content: "⏸️ Lecture mise en pause." };
      }

      case "resume": {
        const queue = this.requireQueue(guild.id);
        if (!queue.paused) return { content: "▶️ Déjà en lecture." };
        this.guardStream(queue.voice.pausingStream, true, guild.id, action);
        queue.resume();
        this.pushState(queue);
        return { content: "▶️ Reprise de la lecture." };
      }

      case "skip": {
        const queue = this.requireQueue(guild.id);
        this.markVoiceStreamsForCleanup(queue.voice, guild.id, action, "skip");
        if (queue.songs.length <= 1) {
          await queue.stop();
          this.clearNowPlaying(guild.id);
          this.pushEmptyState(guild.id);
          return { content: "⏭️ Dernière piste — lecture arrêtée." };
        }
        await queue.skip();
        return { content: "⏭️ Piste suivante." };
      }

      case "stop": {
        const queue = this.requireQueue(guild.id);
        this.markVoiceStreamsForCleanup(queue.voice, guild.id, action, "stop");
        await queue.stop();
        this.clearNowPlaying(guild.id);
        this.pushEmptyState(guild.id);
        return { content: "⏹️ Lecture arrêtée." };
      }

      case "shuffle": {
        const queue = this.requireQueue(guild.id);
        await queue.shuffle();
        this.pushState(queue);
        return { content: "🔀 File mélangée." };
      }

      case "loop": {
        const queue = this.requireQueue(guild.id);
        const arg = payload.arg?.trim();
        const mode =
          arg === "song"
            ? RepeatMode.SONG
            : arg === "queue"
              ? RepeatMode.QUEUE
              : arg === "off"
                ? RepeatMode.DISABLED
                : ((queue.repeatMode + 1) % 3) as RepeatMode;
        queue.setRepeatMode(mode);
        this.pushState(queue);
        const label =
          mode === RepeatMode.SONG ? "🔂 Répétition : piste" : mode === RepeatMode.QUEUE ? "🔁 Répétition : file" : "➡️ Répétition désactivée";
        return { content: label };
      }

      case "volume": {
        const queue = this.requireQueue(guild.id);
        const n = Number(payload.arg);
        if (!Number.isFinite(n) || n < 0 || n > 150) throw new UserError("⚠️ Volume attendu entre 0 et 150.");
        queue.setVolume(n);
        this.pushState(queue);
        return { content: `🔊 Volume : ${n}%` };
      }

      case "seek": {
        const queue = this.requireQueue(guild.id);
        const n = Number(payload.arg);
        if (!Number.isFinite(n) || n < 0) throw new UserError("⚠️ Position invalide.");
        this.markVoiceStreamsForCleanup(queue.voice, guild.id, action, "seek");
        queue.seek(n);
        this.pushState(queue);
        return { content: `⏩ Position : ${formatDuration(n)}` };
      }

      case "remove": {
        const queue = this.requireQueue(guild.id);
        const n = Number(payload.arg);
        if (!Number.isInteger(n) || n < 1 || n >= queue.songs.length) throw new UserError("⚠️ Numéro de file invalide.");
        const [removed] = queue.songs.splice(n, 1);
        this.pushState(queue);
        return { content: `🗑️ Retiré : **${removed?.name ?? "?"}**` };
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

  /** Serialises explicit playback intentions before DisTube's own queue exists. */
  private async withPlaybackLock<T>(
    guildId: string,
    action: MusicActionContext,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.playbackLocks.get(guildId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.playbackLocks.set(guildId, tail);
    await previous;
    this.executingPlaybackActions.set(guildId, action);
    try {
      return await task();
    } finally {
      if (this.executingPlaybackActions.get(guildId) === action) {
        this.executingPlaybackActions.delete(guildId);
      }
      release();
      if (this.playbackLocks.get(guildId) === tail) this.playbackLocks.delete(guildId);
    }
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
    this.pushEmptyState(guildId);
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
  ): Promise<void> {
    const guildId = voiceChannel.guild.id;
    const tracedOptions = {
      ...options,
      metadata: this.instrumentation.metadata(action),
    } as Parameters<DisTube["play"]>[2];
    try {
      await withTimeout(
        this.distube.play(voiceChannel, query, tracedOptions),
        PLAY_TIMEOUT_MS,
        () => new UserError("⏱️ La résolution du morceau a mis trop de temps. Réessaie avec un lien direct."),
      );
    } catch (error) {
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
      }
      this.instrumentation.queueEvent(correlation, action, "ADD_LIST", {
        title: playlist.name,
        detectedTracks: playlist.songs.length,
        queueSize: queue.songs.length,
        firstTitle: playlist.songs[0]?.name ?? null,
      });
      this.publishPlayerState(queue, correlation);
    });
    this.distube.on(DTEvents.FINISH, (queue) => {
      const correlation = this.correlationFromMetadata(queue.songs[0]?.metadata, queue.id);
      this.instrumentation.queueEvent(correlation, undefined, "FINISH", { queueSize: queue.songs.length });
      this.ffmpegTails.delete(queue.id);
      this.clearNowPlaying(queue.id);
      this.pushEmptyState(queue.id, correlation);
    });
    this.distube.on(DTEvents.DISCONNECT, (queue) => {
      const correlation = this.correlationFromMetadata(queue.songs[0]?.metadata, queue.id);
      this.instrumentation.queueEvent(correlation, undefined, "DISCONNECT", { queueSize: queue.songs.length });
      this.ffmpegTails.delete(queue.id);
      this.clearNowPlaying(queue.id);
      this.pushEmptyState(queue.id, correlation);
    });
    // DisTube prefixes ffmpeg diagnostics with [guildId]. Spawn commands are
    // deliberately never retained because they contain the signed input URL.
    this.distube.on(DTEvents.FFMPEG_DEBUG, (debug) => {
      const matched = /^\[([^\]]+)]\s*(.*)$/s.exec(debug);
      if (!matched) return;
      const guildId = matched[1]!;
      const detail = matched[2]!;
      const current = this.distube.getQueue(guildId)?.songs[0];
      const correlation = current
        ? this.correlationFromMetadata(current.metadata, guildId)
        : this.currentAction(guildId);
      if (detail.startsWith("[process] spawn:")) {
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
        queueSize: queue.songs.length,
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
        this.instrumentation.cleanup(guildId, "distube_error", false, correlation);
        this.ffmpegTails.delete(guildId);
        this.pushEmptyState(guildId, correlation);
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
        const queue = this.distube.getQueue(guildId);
        if (newState.status === AudioPlayerStatus.Playing || isPausedPlayerStatus(newState.status)) {
          if (queue) this.pushState(queue, correlation);
        } else if (newState.status === AudioPlayerStatus.Buffering || newState.status === AudioPlayerStatus.Idle) {
          // The current DTO cannot represent "loading". Publishing an empty
          // state is safer than claiming playback at 0:00; Playing republishes
          // the full queue as soon as the player is genuinely ready.
          this.pushEmptyState(guildId, correlation);
        }
      });
      player.on("error", (err) => {
        const correlation = this.currentAction(guildId);
        this.instrumentation.diagnostic("error", "music_player_error", guildId, {
          errorMessage: sanitizeMedia(errMsg(err), 500),
        }, correlation);
        this.pushEmptyState(guildId, correlation);
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
          this.pushEmptyState(guildId, correlation);
        }
      });
      connection.on("error", (err) => {
        const correlation = this.currentAction(guildId);
        this.instrumentation.diagnostic("error", "music_voice_error", guildId, {
          errorMessage: sanitizeMedia(errMsg(err), 500),
        }, correlation);
        this.pushEmptyState(guildId, correlation);
      });
    }
  }

  private async onPlaySong(queue: Queue, song: Song): Promise<void> {
    this.instrumentVoice(queue.id);
    const me = this.client.guilds.cache.get(queue.id)?.members.me?.voice;
    const action = this.actionFromMetadata(song.metadata) ?? this.currentAction(queue.id);
    const correlation = action ?? this.correlationFromMetadata(song.metadata, queue.id);
    this.instrumentation.queueEvent(correlation, action, "PLAY_SONG", {
      title: song.name,
      duration: song.duration,
      queueSize: queue.songs.length,
      playerState: this.distube.voices.get(queue.id)?.audioPlayer.state.status ?? "none",
      voiceChannelPresent: Boolean(me?.channelId),
      serverMute: me?.serverMute ?? null,
      serverDeaf: me?.serverDeaf ?? null,
      selfMute: me?.selfMute ?? null,
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
    return {
      connected: true,
      paused: playerStatus !== AudioPlayerStatus.Playing,
      current: current ? toTrack(current) : null,
      elapsed: Math.floor(queue.currentTime),
      queue: rest.map(toTrack),
      loop: loopLabel(queue.repeatMode),
      volume: queue.volume,
      voiceChannelId: queue.voiceChannel?.id ?? null,
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
      }, resolvedCorrelation),
      (error) => this.instrumentation.dashboard(queue.id, "error", {
        connected: state.connected,
        paused: state.paused,
        currentTitle: state.current?.title ?? null,
        elapsed: state.elapsed,
        queueSize: state.queue.length,
        playerState,
      }, resolvedCorrelation, error),
    );
  }

  /** Publishes only states that the current dashboard DTO can represent safely. */
  private publishPlayerState(queue: Queue, correlation?: MusicCorrelation): void {
    const status = this.distube.voices.get(queue.id)?.audioPlayer.state.status;
    if (status === AudioPlayerStatus.Playing || isPausedPlayerStatus(status as AudioPlayerStatus)) {
      this.pushState(queue, correlation);
    }
  }

  private pushEmptyState(guildId: string, correlation?: MusicCorrelation): void {
    const state = { ...EMPTY_MUSIC_STATE, updatedAt: Date.now() };
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
      }, resolvedCorrelation),
      (error) => this.instrumentation.dashboard(guildId, "error", {
        connected: false,
        paused: false,
        currentTitle: null,
        elapsed: 0,
        queueSize: 0,
        playerState,
      }, resolvedCorrelation, error),
    );
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
