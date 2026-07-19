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

interface NowPlaying {
  messageId: string;
  channelId: string;
  songUrl: string;
  interval: NodeJS.Timeout;
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
  /** Rolling tail of ffmpeg stderr (sanitised only when dumped on error). */
  private ffmpegTail = "";
  /** Voice objects whose state we've already hooked (avoids duplicate listeners). */
  private readonly instrumentedPlayers = new WeakSet<AudioPlayer>();
  private readonly instrumentedConnections = new WeakSet<VoiceConnection>();
  /** Streams keep this guard even if DisTube later detaches its own listener. */
  private readonly guardedStreams = new WeakSet<DisTubeStream>();
  /** Premature closes are expected only for streams deliberately cleaned up. */
  private readonly expectedStreamClosures = new WeakSet<DisTubeStream>();
  /** One explicit /play or /playlist load start sequence per guild at a time. */
  private readonly playbackLocks = new Map<string, Promise<void>>();
  /** Shared confirmation for playSong and the command awaiting real playback. */
  private readonly playingConfirmations = new Map<string, Promise<void>>();

  constructor(
    private readonly client: Client,
    private readonly distube: DisTube,
    private readonly api: WorkerApi,
    private readonly primarySource: PrimarySource = "youtube",
  ) {}

  /** Entry point for the HTTP /music route. Edits the interaction webhook itself. */
  async handle(payload: MusicCommandPayload): Promise<{ ok: boolean; message: string }> {
    let reply: MusicReply;
    let ok = true;
    try {
      reply = await this.run(payload);
    } catch (err) {
      ok = false;
      if (err instanceof UserError) {
        reply = { content: err.message };
      } else {
        console.error(`music ${payload.command} failed:`, errMsg(err));
        reply = { content: "⚠️ Une erreur est survenue avec la musique." };
      }
    }
    if (payload.source === "interaction" && payload.applicationId && payload.token) {
      await this.editInteraction(payload.applicationId, payload.token, reply).catch((e) =>
        console.error("music webhook edit failed:", errMsg(e)),
      );
    }
    return { ok, message: reply.content ?? "OK" };
  }

  private async run(payload: MusicCommandPayload): Promise<MusicReply> {
    const guild = this.client.guilds.cache.get(payload.guildId) ?? (await this.client.guilds.fetch(payload.guildId));

    switch (payload.command) {
      case "play":
      case "playlist_load": {
        return this.withPlaybackLock(guild.id, async () => {
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
                )
              : resolved.query;
            await this.reconcilePlayback(guild.id);
            const before = this.distube.getQueue(guild.id)?.songs.length ?? 0;
            await this.playWithTimeout(voiceChannel, playQuery, { member, textChannel });
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
          await this.reconcilePlayback(guild.id);
          let addedCount = 0;
          for (const t of tracks) {
            let trackUrl: string;
            try {
              trackUrl = resolvePlayQuery(t.url, this.primarySource).query;
            } catch {
              continue; // skip an un-playable saved track (bare playlist, or YT while on SoundCloud)
            }
            const before = this.distube.getQueue(guild.id)?.songs.length ?? 0;
            try {
              await this.playWithTimeout(voiceChannel, trackUrl, { member, textChannel });
              const after = this.distube.getQueue(guild.id)?.songs.length ?? 0;
              addedCount += Math.max(0, after - before);
            } catch (e) {
              console.error("playlist track failed:", errMsg(e));
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
        queue.resume();
        this.pushState(queue);
        return { content: "▶️ Reprise de la lecture." };
      }

      case "skip": {
        const queue = this.requireQueue(guild.id);
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

  /** Serialises explicit playback intentions before DisTube's own queue exists. */
  private async withPlaybackLock<T>(guildId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.playbackLocks.get(guildId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.playbackLocks.set(guildId, tail);
    await previous;
    try {
      return await task();
    } finally {
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
  private async reconcilePlayback(guildId: string): Promise<void> {
    const queue = this.distube.getQueue(guildId);
    const voice = this.distube.voices.get(guildId);
    if (!voice) return;
    this.guardVoiceStreams(voice);

    const playerStatus = voice.audioPlayer.state.status;
    if (queue) {
      if (queue.paused) {
        this.guardStream(voice.pausingStream, true);
        await queue.resume();
      } else if (isPausedPlayerStatus(playerStatus)) {
        // queue.resume() rejects when queue.paused is already false. The public
        // DisTubeVoice API is the narrowest safe repair for this desync.
        this.guardStream(voice.pausingStream, true);
        voice.unpause();
        if (isPausedPlayerStatus(voice.audioPlayer.state.status)) voice.audioPlayer.unpause();
      }
      return;
    }

    if (isPausedPlayerStatus(playerStatus)) {
      this.markVoiceStreamsForCleanup(voice);
      this.distube.voices.leave(guildId);
    }
  }

  /** Keeps a targeted error listener attached even if DisTube replaces its own. */
  private guardStream(stream: DisTubeStream | undefined, expectedClose = false): void {
    if (!stream) return;
    if (expectedClose) this.expectedStreamClosures.add(stream);
    if (this.guardedStreams.has(stream)) return;
    this.guardedStreams.add(stream);
    stream.on("error", (error) => {
      const code = streamErrorCode(error);
      if (code === "ERR_STREAM_PREMATURE_CLOSE" && this.expectedStreamClosures.has(stream)) {
        console.warn("music: stream closed during intentional cleanup (ERR_STREAM_PREMATURE_CLOSE)");
        return;
      }
      console.error(`music: guarded stream error${code ? ` (${code})` : ""}: ${sanitizeMedia(errMsg(error), 500)}`);
    });
  }

  private guardVoiceStreams(voice: DisTubeVoice): void {
    this.guardStream(voice.stream);
    this.guardStream(voice.pausingStream);
  }

  private markVoiceStreamsForCleanup(voice: DisTubeVoice): void {
    this.guardStream(voice.stream, true);
    this.guardStream(voice.pausingStream, true);
  }

  /** Removes a start attempt that never reached the real Playing state. */
  private async cleanupBlockedPlayback(guildId: string): Promise<void> {
    const queue = this.distube.getQueue(guildId);
    const voice = this.distube.voices.get(guildId);
    if (voice) this.markVoiceStreamsForCleanup(voice);
    await queue?.stop().catch((error) =>
      console.error(`music: blocked queue cleanup failed: ${sanitizeMedia(errMsg(error), 300)}`),
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
      this.guardVoiceStreams(voice);
      try {
        await entersState(voice.audioPlayer, AudioPlayerStatus.Playing, PLAYER_START_TIMEOUT_MS);
      } catch {
        const status = voice.audioPlayer.state.status;
        console.error(`music: player start timeout (guild ${guildId}, status=${status})`);
        await this.cleanupBlockedPlayback(guildId);
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
  ): Promise<void> {
    const guildId = voiceChannel.guild.id;
    try {
      await withTimeout(
        this.distube.play(voiceChannel, query, options),
        PLAY_TIMEOUT_MS,
        () => new UserError("⏱️ La résolution du morceau a mis trop de temps. Réessaie avec un lien direct."),
      );
    } catch (error) {
      // A failed addition must not interrupt an already Playing current song.
      // A half-created non-playing queue, however, must not survive the timeout.
      const status = this.distube.voices.get(guildId)?.audioPlayer.state.status;
      if (status !== AudioPlayerStatus.Playing) await this.cleanupBlockedPlayback(guildId);
      throw error;
    }
    this.instrumentVoice(guildId);
    const voice = this.distube.voices.get(guildId);
    if (voice) this.guardVoiceStreams(voice);
    await this.confirmPlaying(guildId);
  }

  // --- DisTube events -------------------------------------------------------

  registerEvents(): void {
    this.distube.on(DTEvents.PLAY_SONG, (queue, song) => void this.onPlaySong(queue, song));
    this.distube.on(DTEvents.ADD_SONG, (queue) => this.publishPlayerState(queue));
    this.distube.on(DTEvents.ADD_LIST, (queue) => this.publishPlayerState(queue));
    this.distube.on(DTEvents.FINISH, (queue) => {
      this.clearNowPlaying(queue.id);
      this.pushEmptyState(queue.id);
    });
    this.distube.on(DTEvents.DISCONNECT, (queue) => {
      console.log(`music: disconnect (guild ${queue.id})`);
      this.clearNowPlaying(queue.id);
      this.pushEmptyState(queue.id);
    });
    // ffmpeg stderr streams here (no guild attached); keep a bounded rolling
    // tail and only dump it — sanitised — when a DisTube error fires.
    this.distube.on(DTEvents.FFMPEG_DEBUG, (debug) => {
      this.ffmpegTail = `${this.ffmpegTail}\n${debug}`.slice(-4000);
    });
    this.distube.on(DTEvents.FINISH_SONG, (queue, song) => {
      console.log(`music: finishSong (guild ${queue.id}) "${song.name}"`);
    });
    // NB: DisTube v5.2.3 has no `empty` event — the closest lifecycle signals
    // are DISCONNECT (above) and FINISH.
    this.distube.on(DTEvents.ERROR, (error, queue, song) => {
      const message = errMsg(error);
      console.error(`distube error (guild ${queue?.id ?? "?"}):`, message);
      const code = /code (\d+)/.exec(String(message))?.[1];
      if (code) console.error(`  ↳ ffmpeg exit code=${code}`);
      if (song) console.error(`  ↳ song "${song.name}" (${formatDuration(song.duration ?? 0)})`);
      if (this.ffmpegTail) {
        console.error(`  ↳ ffmpeg stderr tail: ${sanitizeMedia(this.ffmpegTail, 1000)}`);
      }
      if (queue) this.pushEmptyState(queue.id);
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
        if (oldState.status !== newState.status) {
          console.log(`music: player ${oldState.status} → ${newState.status} (guild ${guildId})`);
        }
        const queue = this.distube.getQueue(guildId);
        if (newState.status === AudioPlayerStatus.Playing || isPausedPlayerStatus(newState.status)) {
          if (queue) this.pushState(queue);
        } else if (newState.status === AudioPlayerStatus.Buffering || newState.status === AudioPlayerStatus.Idle) {
          // The current DTO cannot represent "loading". Publishing an empty
          // state is safer than claiming playback at 0:00; Playing republishes
          // the full queue as soon as the player is genuinely ready.
          this.pushEmptyState(guildId);
        }
      });
      player.on("error", (err) => {
        console.error(`music: player error (guild ${guildId}): ${sanitizeMedia(errMsg(err), 500)}`);
        this.pushEmptyState(guildId);
      });
    }

    const connection = voice.connection;
    if (connection && !this.instrumentedConnections.has(connection)) {
      this.instrumentedConnections.add(connection);
      connection.on("stateChange", (oldState, newState) => {
        if (oldState.status !== newState.status) {
          console.log(`music: voice ${oldState.status} → ${newState.status} (guild ${guildId})`);
        }
        if (newState.status === "disconnected" || newState.status === "destroyed") this.pushEmptyState(guildId);
      });
      connection.on("error", (err) => {
        console.error(`music: voice error (guild ${guildId}): ${sanitizeMedia(errMsg(err), 500)}`);
        this.pushEmptyState(guildId);
      });
    }
  }

  private async onPlaySong(queue: Queue, song: Song): Promise<void> {
    this.instrumentVoice(queue.id);
    const me = this.client.guilds.cache.get(queue.id)?.members.me?.voice;
    console.log(
      `music: playSong (guild ${queue.id}) "${song.name}" dur=${formatDuration(song.duration ?? 0)} ` +
        `channel=${me?.channelId ?? "none"} serverMute=${me?.serverMute ?? "?"} serverDeaf=${me?.serverDeaf ?? "?"} ` +
        `selfMute=${me?.selfMute ?? "?"}`,
    );
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
        this.pushState(q);
        void msg.edit({ embeds: [nowPlayingEmbed(q).toJSON()] }).catch(() => {});
      }, 15_000);
      interval.unref();
      this.nowPlaying.set(queue.id, { messageId: msg.id, channelId: channel.id, songUrl: song.url ?? "", interval });
    } catch (err) {
      console.error("now-playing message failed:", errMsg(err));
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

  private pushState(queue: Queue): void {
    this.api.postMusicState(queue.id, this.buildState(queue)).catch((e) =>
      console.error("push music state failed:", errMsg(e)),
    );
  }

  /** Publishes only states that the current dashboard DTO can represent safely. */
  private publishPlayerState(queue: Queue): void {
    const status = this.distube.voices.get(queue.id)?.audioPlayer.state.status;
    if (status === AudioPlayerStatus.Playing || isPausedPlayerStatus(status as AudioPlayerStatus)) {
      this.pushState(queue);
    }
  }

  private pushEmptyState(guildId: string): void {
    this.api.postMusicState(guildId, { ...EMPTY_MUSIC_STATE, updatedAt: Date.now() }).catch(() => {});
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
