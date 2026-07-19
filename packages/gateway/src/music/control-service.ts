import { RepeatMode, type Queue } from "distube";
import type { MusicControlRequest } from "@bot/shared";
import { UserError, type MusicReply } from "./format.js";
import type { MusicActionContext, MusicCorrelation } from "./instrumentation.js";

export interface MusicControlHooks {
  getQueue(guildId: string): Queue | undefined;
  authorize(queue: Queue, guildId: string, userId: string): Promise<void>;
  enter(guildId: string, action: MusicActionContext): void;
  leave(guildId: string, action: MusicActionContext): void;
  prepareStreamCleanup(queue: Queue, guildId: string, action: MusicCorrelation, reason: string): void;
  prepareResume(queue: Queue, guildId: string, action: MusicCorrelation): void;
  publish(queue: Queue, action: MusicCorrelation): void;
  publishStopped(guildId: string, action: MusicCorrelation): void;
  clearNowPlaying(guildId: string): void;
}

/** One bounded mutation lane per guild, shared by Discord and panel actions. */
export class MusicControlService {
  private readonly guildLocks = new Map<string, Promise<void>>();

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
    return this.withGuildLock(guildId, action, async () => {
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
      }
    });
  }
}
