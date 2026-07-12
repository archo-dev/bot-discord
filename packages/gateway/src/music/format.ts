/** Musique — helpers purs : formats de durée/progression, conversion Song → MusicTrack. */

import { RepeatMode, type Song } from "distube";
import type { MusicStateDto, MusicTrack } from "@bot/shared";

/** User-facing error whose message is shown as-is (not logged as a crash). */
export class UserError extends Error {}

export interface MusicReply {
  content?: string;
  embeds?: object[];
}

export function formatDuration(totalSeconds: number): string {
  const sec = Math.floor(totalSeconds % 60);
  const min = Math.floor(totalSeconds / 60) % 60;
  const hrs = Math.floor(totalSeconds / 3600);
  const mm = String(min).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${min}:${ss}`;
}

export function progressBar(elapsed: number, total: number, width = 18): string {
  if (!total) return "🔴 Live";
  const filled = Math.min(width, Math.max(0, Math.round((elapsed / total) * width)));
  return "▬".repeat(filled) + "🔘" + "▬".repeat(Math.max(0, width - filled - 1));
}

export function toTrack(song: Song): MusicTrack {
  return {
    title: song.name ?? "Titre inconnu",
    url: song.url ?? "",
    duration: song.duration ?? 0,
    thumbnail: song.thumbnail ?? null,
    requestedBy: song.user?.id ?? null,
  };
}

export function loopLabel(mode: RepeatMode): MusicStateDto["loop"] {
  return mode === RepeatMode.SONG ? "song" : mode === RepeatMode.QUEUE ? "queue" : "off";
}
