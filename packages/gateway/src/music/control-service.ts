import { RepeatMode, type Queue } from "distube";
import type { MusicControlRequest } from "@bot/shared";
import { UserError, type MusicReply } from "./format.js";
import type { MusicActionContext, MusicCorrelation } from "./instrumentation.js";

export interface MusicControlHooks {
  getQueue(guildId: string): Queue | undefined;
  authorize(queue: Queue, guildId: string, userId: string): Promise<void>;
  seekTarget(queue: Queue): { duration: number; seekable: boolean };
  enter(guildId: string, action: MusicActionContext): void;
  leave(guildId: string, action: MusicActionContext): void;
  prepareStreamCleanup(queue: Queue, guildId: string, action: MusicCorrelation, reason: string): void;
  prepareResume(queue: Queue, guildId: string, action: MusicCorrelation): void;
  publish(queue: Queue, action: MusicCorrelation): void;
  publishStopped(guildId: string, action: MusicCorrelation): void;
  publishError(guildId: string, action: MusicCorrelation): void;
  clearNowPlaying(guildId: string): void;
  /** Floored playback position (seconds) of the current song. */
  currentPosition(queue: Queue): number;
  /**
   * Drops the cached (possibly expired) stream URL of the current song so the
   * next ffmpeg restart resolves a fresh signed URL via the plugin instead of
   * replaying a stale HLS URL that the source now answers with 403.
   */
  refreshStreamUrl(queue: Queue): void;
  /**
   * Waits for the AudioPlayer to actually reach Playing after a seek restart.
   * Resolves `false` — without tearing the queue down — when the fresh stream
   * stalls or dies (e.g. the source still refuses it).
   */
  confirmSeek(queue: Queue, guildId: string, action: MusicCorrelation): Promise<boolean>;
}

/** One bounded mutation lane per guild, shared by Discord and panel actions. */
export class MusicControlService {
  private readonly guildLocks = new Map<string, Promise<void>>();
  private readonly activeSeeks = new Set<string>();

  constructor(private readonly hooks: MusicControlHooks) {}

  async withGuildLock<T>(guildId: string, action: MusicActionContext, task: () => Promise<T>): Promise<T> {
    const previous = this.guildLocks.get(guildId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.guildLocks.set(guildId, tail);
    await previous;
    this.hooks.enter(guildId, action);
    try {
      return await task();
    } finally {
      this.hooks.leave(guildId, action);
      release();
      if (this.guildLocks.get(guildId) === tail) this.guildLocks.delete(guildId);
    }
  }

  execute(
    guildId: string,
    userId: string,
    request: MusicControlRequest,
    action: MusicActionContext,
  ): Promise<MusicReply> {
    if (request.action === "seek") {
      if (this.activeSeeks.has(guildId)) {
        return Promise.reject(new UserError("⚠️ Un déplacement est déjà en cours."));
      }
      this.activeSeeks.add(guildId);
    }
    const result = this.withGuildLock(guildId, action, async () => {
      const queue = this.hooks.getQueue(guildId);
      if (!queue) throw new UserError("⚠️ Aucune musique en cours.");
      await this.hooks.authorize(queue, guildId, userId);

      switch (request.action) {
        case "pause":
          if (queue.paused) return { content: "⏸️ Déjà en pause." };
          await queue.pause();
          this.hooks.publish(queue, action);
          return { content: "⏸️ Lecture mise en pause." };

        case "resume":
          if (!queue.paused) return { content: "▶️ Déjà en lecture." };
          this.hooks.prepareResume(queue, guildId, action);
          await queue.resume();
          this.hooks.publish(queue, action);
          return { content: "▶️ Reprise de la lecture." };

        case "skip":
          this.hooks.prepareStreamCleanup(queue, guildId, action, "skip");
          if (queue.songs.length <= 1) {
            await queue.stop();
            this.hooks.clearNowPlaying(guildId);
            this.hooks.publishStopped(guildId, action);
            return { content: "⏭️ Dernière piste — lecture arrêtée." };
          }
          await queue.skip();
          return { content: "⏭️ Piste suivante." };

        case "stop":
          this.hooks.prepareStreamCleanup(queue, guildId, action, "stop");
          await queue.stop();
          this.hooks.clearNowPlaying(guildId);
          this.hooks.publishStopped(guildId, action);
          return { content: "⏹️ Lecture arrêtée." };

        case "shuffle":
          await queue.shuffle();
          this.hooks.publish(queue, action);
          return { content: "🔀 File mélangée." };

        case "volume":
          queue.setVolume(request.value);
          this.hooks.publish(queue, action);
          return { content: `🔊 Volume : ${request.value}%` };

        case "repeat": {
          const mode = request.mode === "song"
            ? RepeatMode.SONG
            : request.mode === "queue"
              ? RepeatMode.QUEUE
              : request.mode === "off"
                ? RepeatMode.DISABLED
                : ((queue.repeatMode + 1) % 3) as RepeatMode;
          queue.setRepeatMode(mode);
          this.hooks.publish(queue, action);
          const label = mode === RepeatMode.SONG
            ? "🔂 Répétition : piste"
            : mode === RepeatMode.QUEUE
              ? "🔁 Répétition : file"
              : "➡️ Répétition désactivée";
          return { content: label };
        }

        case "remove": {
          if (request.position >= queue.songs.length) throw new UserError("⚠️ Numéro de file invalide.");
          const [removed] = queue.songs.splice(request.position, 1);
          this.hooks.publish(queue, action);
          return { content: `🗑️ Retiré : **${removed?.name ?? "?"}**` };
        }

        case "seek": {
          const target = this.hooks.seekTarget(queue);
          if (!target.seekable || target.duration <= 0) {
            throw new UserError("⚠️ Cette piste ne permet pas de changer la position.");
          }
          if (request.position > target.duration) {
            throw new UserError(`⚠️ Position attendue entre 0 et ${Math.floor(target.duration)} secondes.`);
          }
          const expectedSong = queue.songs[0];
          const previousPosition = this.hooks.currentPosition(queue);
          // A paused queue only re-spawns ffmpeg on the next resume, so there is
          // no Playing state to confirm at seek time — the offset is applied then.
          const paused = queue.paused;

          // Restarts playback at `position` on a freshly resolved stream URL and,
          // for a playing queue, confirms it truly resumed. Never tears the queue
          // down itself: DisTube already handles a hard stream failure.
          const applySeek = async (position: number): Promise<"ok" | "failed" | "changed"> => {
            this.hooks.refreshStreamUrl(queue);
            this.hooks.prepareStreamCleanup(queue, guildId, action, "seek");
            await queue.seek(position);
            if (this.hooks.getQueue(guildId) !== queue || queue.songs[0] !== expectedSong) return "changed";
            if (paused) return "ok";
            return (await this.hooks.confirmSeek(queue, guildId, action)) ? "ok" : "failed";
          };

          const outcome = await applySeek(request.position);
          if (outcome === "changed") throw new UserError("⚠️ La piste a changé pendant le déplacement.");
          if (outcome === "ok") {
            this.hooks.publish(queue, action);
            return { content: `⏩ Position : ${Math.floor(request.position)} s` };
          }

          // The fresh stream was refused/stalled. Roll back to the previous
          // position when the queue survived, rather than leaving a dead seek.
          if (this.hooks.getQueue(guildId) === queue && queue.songs[0] === expectedSong) {
            const restore = await applySeek(previousPosition);
            if (restore === "ok") {
              this.hooks.publish(queue, action);
              throw new UserError("⚠️ Position refusée par la source — lecture reprise à la position précédente.");
            }
          }
          // No recovery possible: surface a recoverable error, never a false
          // success and never a silent idle that looks like a normal end.
          this.hooks.publishError(guildId, action);
          throw new UserError("⚠️ Impossible de changer la position : le flux a été refusé par la source.");
        }
      }
    });
    return request.action === "seek"
      ? result.finally(() => this.activeSeeks.delete(guildId))
      : result;
  }
}
