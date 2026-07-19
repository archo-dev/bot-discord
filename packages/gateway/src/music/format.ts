/** Musique — helpers purs : formats de durée/progression, conversion Song → MusicTrack. */

import { RepeatMode, type Song } from "distube";
import type { MusicStateDto, MusicTrack } from "@bot/shared";

/** User-facing error whose message is shown as-is (not logged as a crash). */
export class UserError extends Error {}

/**
 * Normalizes a play query before handing it to DisTube/yt-dlp.
 *
 * A YouTube watch/short/youtu.be URL is reduced to its bare `watch?v=<id>`
 * form: playlist and mix params (`list=RD…&start_radio=1`, `index`, `pp`, …)
 * are dropped so yt-dlp never enumerates a 300-song radio mix — the hang that
 * blocked `/play`. A bare playlist URL is rejected (out of scope). Text
 * searches and non-YouTube URLs (Spotify, …) are returned unchanged.
 */
export function normalizeQuery(query: string): string {
  const raw = query.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw; // not a URL → text search, leave as-is (ytsearch)
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  // youtu.be/<id> → watch?v=<id>
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (id) return `https://www.youtube.com/watch?v=${id}`;
    return raw;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    // youtube.com/shorts/<id> → watch?v=<id>
    const shorts = url.pathname.match(/^\/shorts\/([^/]+)/);
    if (shorts?.[1]) return `https://www.youtube.com/watch?v=${shorts[1]}`;

    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }

    // Bare playlist URL (no video id) → rejected: full playlists are out of scope.
    if (url.pathname === "/playlist" || (url.searchParams.has("list") && !url.searchParams.get("v"))) {
      throw new UserError(
        "⚠️ Les playlists YouTube complètes ne sont pas encore prises en charge. Envoie le lien direct d’une vidéo.",
      );
    }
  }

  return raw; // other hosts (Spotify, SoundCloud, …) untouched
}

/** Primary music source. YouTube is the long-term target; SoundCloud is a
 *  temporary stand-in while the OVH IP can't reach YouTube's media CDN. */
export type PrimarySource = "youtube" | "soundcloud";

export interface ResolvedQuery {
  /** The concrete query handed to `distube.play()`. */
  query: string;
  /** Origin of the resulting track, for user-facing labelling. */
  source: "youtube" | "soundcloud" | "url";
}

/**
 * Routes a raw `/play` input to a concrete query, honouring the primary source.
 *
 * - SoundCloud URLs always play (yt-dlp resolves them, served from SoundCloud's
 *   own CDN — reachable from OVH).
 * - In `soundcloud` mode, a plain text search becomes a SoundCloud search
 *   (`scsearch1:`) and a YouTube URL is refused with a clean UserError (YouTube
 *   is temporarily unavailable) — no aggressive extraction is attempted.
 * - In `youtube` mode, behaviour is unchanged: YouTube URLs are cleaned via
 *   {@link normalizeQuery} and text is left as-is (yt-dlp's `--default-search`).
 * Non-YouTube/SoundCloud URLs (Spotify, Bandcamp, …) pass through untouched.
 */
export function resolvePlayQuery(raw: string, primary: PrimarySource): ResolvedQuery {
  const trimmed = raw.trim();
  if (!trimmed) throw new UserError("⚠️ Précise un titre ou un lien.");

  let url: URL | null = null;
  try {
    url = new URL(trimmed);
  } catch {
    url = null;
  }

  if (url) {
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const isSoundcloud = host === "soundcloud.com" || host.endsWith(".soundcloud.com");
    const isYouTube =
      host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtu.be";

    if (isSoundcloud) return { query: trimmed, source: "soundcloud" };
    if (isYouTube) {
      if (primary === "soundcloud") {
        throw new UserError(
          "⚠️ YouTube est temporairement indisponible. Envoie un lien **SoundCloud**, ou fais une **recherche par titre** (les résultats viennent de SoundCloud).",
        );
      }
      return { query: normalizeQuery(trimmed), source: "youtube" };
    }
    return { query: trimmed, source: "url" }; // Spotify, Bandcamp, direct file…
  }

  // Plain text search.
  if (primary === "soundcloud") return { query: `scsearch1:${trimmed}`, source: "soundcloud" };
  return { query: trimmed, source: "youtube" };
}

/** Runs `promise` but rejects with `onTimeout()` if it doesn't settle in `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** Extraction timeout (ms) for a single `distube.play()` call. */
export const PLAY_TIMEOUT_MS = 40_000;

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
