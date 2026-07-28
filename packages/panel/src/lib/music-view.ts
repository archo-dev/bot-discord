import type { MusicStateDto } from "@bot/shared";

export function formatMusicDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "Live";
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function musicStatusLabel(status: MusicStateDto["status"]): string {
  return {
    idle: "Aucune lecture",
    buffering: "Chargement",
    playing: "En lecture",
    paused: "En pause",
    stopped: "Lecture arrêtée",
    error: "Erreur de lecture",
  }[status];
}

export function musicLoopLabel(loop: MusicStateDto["loop"]): string {
  return {
    off: "Sans répétition",
    song: "Répéter la piste",
    queue: "Répéter la file",
  }[loop];
}

export function musicSourceLabel(url: string | null): string {
  if (!url) return "Source non disponible";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host ? `Source : ${host}` : "Source non disponible";
  } catch {
    return "Source non disponible";
  }
}
