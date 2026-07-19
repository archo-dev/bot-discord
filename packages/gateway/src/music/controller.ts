/** Musique — contrôleur DisTube : exécution des commandes, events, état → KV (panel). */

import { DisTube, Events as DTEvents, RepeatMode, type Queue, type Song } from "distube";
import { type Client, type GuildTextBasedChannel } from "discord.js";
import type { AudioPlayer, VoiceConnection } from "@discordjs/voice";
import { EMPTY_MUSIC_STATE, type MusicCommandPayload, type MusicStateDto } from "@bot/shared";
import type { WorkerApi } from "../worker-api.js";
import { errMsg } from "../util.js";
import {
  PLAY_TIMEOUT_MS,
  UserError,
  formatDuration,
  loopLabel,
  resolvePlayQuery,
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

export class MusicController {
  private readonly nowPlaying = new Map<string, NowPlaying>();

  // --- Diagnostics (M: instrumentation ffmpeg/voice) ------------------------
  /** Rolling tail of ffmpeg stderr (sanitised only when dumped on error). */
  private ffmpegTail = "";
  /** Voice objects whose state we've already hooked (avoids duplicate listeners). */
  private readonly instrumentedPlayers = new WeakSet<AudioPlayer>();
  private readonly instrumentedConnections = new WeakSet<VoiceConnection>();

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
          const before = this.distube.getQueue(guild.id)?.songs.length ?? 0;
          try {
            await this.playWithTimeout(voiceChannel, resolved.query, { member, textChannel });
            // Hook voice/player state as early as the connection exists, so we
            // capture the signalling → ready transition (not just from playSong).
            this.instrumentVoice(guild.id);
          } catch (err) {
            // On timeout, don't leave a half-built queue behind.
            if (err instanceof UserError) await this.distube.getQueue(guild.id)?.stop().catch(() => {});
            throw err;
          }
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
        for (const t of tracks) {
          let trackUrl: string;
          try {
            trackUrl = resolvePlayQuery(t.url, this.primarySource).query;
          } catch {
            continue; // skip an un-playable saved track (bare playlist, or YT while on SoundCloud)
          }
          await this.playWithTimeout(voiceChannel, trackUrl, { member, textChannel }).catch((e) =>
            console.error("playlist track failed:", errMsg(e)),
          );
        }
        return { content: `📥 Playlist **${name}** chargée (${tracks.length} pistes).` };
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

  /** distube.play() bounded by PLAY_TIMEOUT_MS so a stuck extraction can't
   *  hang the interaction indefinitely. Rejects with a UserError on timeout. */
  private playWithTimeout(
    voiceChannel: Parameters<DisTube["play"]>[0],
    query: Parameters<DisTube["play"]>[1],
    options: Parameters<DisTube["play"]>[2],
  ): Promise<void> {
    return withTimeout(
      this.distube.play(voiceChannel, query, options),
      PLAY_TIMEOUT_MS,
      () => new UserError("⏱️ YouTube met trop de temps à répondre. Réessaie avec un lien direct vers une vidéo."),
    );
  }

  // --- DisTube events -------------------------------------------------------

  registerEvents(): void {
    this.distube.on(DTEvents.PLAY_SONG, (queue, song) => void this.onPlaySong(queue, song));
    this.distube.on(DTEvents.ADD_SONG, (queue) => this.pushState(queue));
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
      });
      player.on("error", (err) => {
        console.error(`music: player error (guild ${guildId}): ${sanitizeMedia(errMsg(err), 500)}`);
      });
    }

    const connection = voice.connection;
    if (connection && !this.instrumentedConnections.has(connection)) {
      this.instrumentedConnections.add(connection);
      connection.on("stateChange", (oldState, newState) => {
        if (oldState.status !== newState.status) {
          console.log(`music: voice ${oldState.status} → ${newState.status} (guild ${guildId})`);
        }
      });
      connection.on("error", (err) => {
        console.error(`music: voice error (guild ${guildId}): ${sanitizeMedia(errMsg(err), 500)}`);
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
    this.pushState(queue);
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
    return {
      connected: true,
      paused: queue.paused,
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
