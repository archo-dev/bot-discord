/** Musique — helpers purs : formats de durée/progression, conversion Song → MusicTrack. */

import { RepeatMode, type Song } from "distube";
import type { MusicStateDto, MusicTrack } from "@bot/shared";
import { sanitizeMedia } from "./log-sanitize.js";
import { errMsg } from "../util.js";

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
  /** The concrete query handed to `distube.play()`, or — when
   *  {@link ResolvedQuery.soundcloudSearch} is set — the raw search text. */
  query: string;
  /** Origin of the resulting track, for user-facing labelling. */
  source: "youtube" | "soundcloud" | "url";
  /** When true, `query` is a SoundCloud search TEXT to pre-resolve to a track
   *  URL via {@link resolveSoundcloudSearch} before handing it to DisTube. */
  soundcloudSearch?: boolean;
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
  if (primary === "soundcloud") return { query: trimmed, source: "soundcloud", soundcloudSearch: true };
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

/** Bound for the SoundCloud search pre-resolution (yt-dlp `scsearchN:`). */
export const SC_SEARCH_TIMEOUT_MS = 15_000;
/** How many search results to scan for a usable (non-DRM, full) track. */
export const SC_SEARCH_RESULTS = 5;
/** Tracks at/under this many seconds are treated as Go+ previews and skipped. */
export const SC_MIN_DURATION_SEC = 40;

const NO_SC_RESULT = "⚠️ Aucun résultat SoundCloud trouvé pour cette recherche.";
const NO_PLAYABLE_SC = "⚠️ Aucun morceau SoundCloud complet et lisible n’a été trouvé.";
const NO_PRECISE_SC = "⚠️ Aucun morceau complet correspondant précisément à votre recherche n'a été trouvé.";

const SC_RELEVANCE_THRESHOLD = 180;
const SC_VARIANTS = [
  "remix",
  "mashup",
  "live",
  "cover",
  "sped up",
  "slowed",
  "nightcore",
  "instrumental",
  "karaoke",
  "reverb",
  "edit",
] as const;
const SC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "au",
  "aux",
  "clip",
  "d",
  "de",
  "des",
  "du",
  "en",
  "et",
  "feat",
  "featuring",
  "ft",
  "l",
  "la",
  "le",
  "les",
  "officiel",
  "official",
  "the",
  "un",
  "une",
  "video",
]);

/** Stable local normalisation used by the relevance scorer (no I/O). */
export function normalizeSoundcloudText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function significantTokens(value: string): string[] {
  return [...new Set(value.split(" ").filter((token) => token.length > 1 && !SC_STOP_WORDS.has(token)))];
}

function sameTokens(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((token) => right.has(token));
}

function hasPhrase(value: string, phrase: string): boolean {
  return ` ${value} `.includes(` ${phrase} `);
}

type SoundcloudRejectionReason =
  | "drm"
  | "preview"
  | "invalid_url"
  | "unwanted_variant"
  | "missing_query_terms"
  | "below_threshold";

interface SoundcloudRelevanceEntry {
  index: number;
  title: string;
  uploader: string;
  duration: number | null;
  score: number | null;
  decision: "accepted" | "rejected";
  reasons: SoundcloudRejectionReason[];
}

interface SoundcloudRelevanceTrace {
  query: string;
  entriesReceived: number;
  entries: SoundcloudRelevanceEntry[];
  selected: { index: number; title: string; uploader: string } | null;
  selectedScore: number | null;
  threshold: number;
}

function sanitizeRelevanceField(value: unknown, maxLen = 120): string {
  return sanitizeMedia(value, maxLen)
    .replace(/\bhttps?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(sig|signature|token)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

function relevanceScore(value: number): number {
  return Math.round(value * 100) / 100;
}

/** First public soundcloud.com track URL of an entry (webpage_url preferred). */
function publicSoundcloudUrl(entry: { webpage_url?: unknown; url?: unknown }): string | null {
  for (const cand of [entry.webpage_url, entry.url]) {
    if (typeof cand !== "string" || !/^https?:\/\//i.test(cand)) continue;
    try {
      const host = new URL(cand).hostname.replace(/^www\./, "").toLowerCase();
      if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) return cand;
    } catch {
      /* not a URL */
    }
  }
  return null;
}

/** Whether yt-dlp flagged this entry as DRM/subscription-locked. */
function isDrmLocked(entry: { drm?: unknown; has_drm?: unknown; availability?: unknown }): boolean {
  if (entry.drm === true || entry.has_drm === true) return true;
  const avail = typeof entry.availability === "string" ? entry.availability.toLowerCase() : "";
  return ["needs_auth", "premium_only", "subscriber_only"].includes(avail);
}

/**
 * Scans up to {@link SC_SEARCH_RESULTS} entries of a `scsearchN:` result and
 * returns the first genuinely playable SoundCloud track URL — skipping DRM
 * entries (also nulled out by yt-dlp's `--ignore-errors`), ≤40s Go+ previews,
 * and entries without a public soundcloud.com URL. Never bypasses DRM.
 * Throws a {@link UserError} when none qualifies.
 */
export function pickPlayableSoundcloudUrl(info: unknown, query: string, trace?: SoundcloudRelevanceTrace): string {
  const entries = (info as { entries?: unknown } | null)?.entries;
  if (trace) trace.entriesReceived = Array.isArray(entries) ? entries.length : 0;
  if (!Array.isArray(entries) || entries.length === 0) throw new UserError(NO_PLAYABLE_SC);
  const normalizedQuery = normalizeSoundcloudText(query);
  const queryTokens = significantTokens(normalizedQuery);
  const querySet = new Set(queryTokens);
  if (queryTokens.length === 0) throw new UserError(NO_PRECISE_SC);

  let best: { score: number; url: string; diagnostic: SoundcloudRelevanceEntry } | null = null;
  let sawPlayableEntry = false;
  for (const [index, raw] of entries.slice(0, SC_SEARCH_RESULTS).entries()) {
    const diagnostic: SoundcloudRelevanceEntry = {
      index,
      title: sanitizeRelevanceField((raw as { title?: unknown } | null)?.title),
      uploader: sanitizeRelevanceField((raw as { uploader?: unknown } | null)?.uploader),
      duration:
        typeof (raw as { duration?: unknown } | null)?.duration === "number"
          ? ((raw as { duration: number }).duration ?? null)
          : null,
      score: null,
      decision: "rejected",
      reasons: [],
    };
    if (!raw || typeof raw !== "object") {
      diagnostic.reasons.push("invalid_url"); // null/invalid entries have no public URL
      trace?.entries.push(diagnostic);
      continue;
    }
    const entry = raw as {
      title?: unknown;
      uploader?: unknown;
      uploader_id?: unknown;
      duration?: unknown;
      drm?: unknown;
      has_drm?: unknown;
      availability?: unknown;
    };
    if (isDrmLocked(entry)) diagnostic.reasons.push("drm");
    if (typeof entry.duration === "number" && entry.duration <= SC_MIN_DURATION_SEC) {
      diagnostic.reasons.push("preview");
    }
    const url = publicSoundcloudUrl(entry as { webpage_url?: unknown; url?: unknown });
    if (!url) diagnostic.reasons.push("invalid_url");
    if (diagnostic.reasons.length > 0 || !url) {
      trace?.entries.push(diagnostic);
      continue;
    }
    sawPlayableEntry = true;

    const title = normalizeSoundcloudText(entry.title);
    const uploader = normalizeSoundcloudText(entry.uploader);
    const uploaderId = normalizeSoundcloudText(entry.uploader_id);
    if (!title) {
      diagnostic.reasons.push("missing_query_terms");
      trace?.entries.push(diagnostic);
      continue;
    }

    // A requested variant is allowed, but any additional variant remains a
    // hard rejection: conservatively refuse instead of guessing a remix.
    if (SC_VARIANTS.some((variant) => hasPhrase(title, variant) && !hasPhrase(normalizedQuery, variant))) {
      diagnostic.reasons.push("unwanted_variant");
      trace?.entries.push(diagnostic);
      continue;
    }

    const titleSet = new Set(significantTokens(title));
    const uploaderSet = new Set([...significantTokens(uploader), ...significantTokens(uploaderId)]);
    const combinedSet = new Set([...titleSet, ...uploaderSet]);
    const titleMatches = queryTokens.filter((token) => titleSet.has(token)).length;
    const uploaderMatches = queryTokens.filter((token) => uploaderSet.has(token)).length;
    const combinedMatches = queryTokens.filter((token) => combinedSet.has(token)).length;
    const titleCoverage = titleMatches / queryTokens.length;
    const combinedCoverage = combinedMatches / queryTokens.length;
    const extraTitleTokens = [...titleSet].filter((token) => !querySet.has(token) && !uploaderSet.has(token)).length;

    let score = titleCoverage * 80 + combinedCoverage * 70;
    if (title === normalizedQuery) score += 180;
    if (
      `${uploader} ${title}`.trim() === normalizedQuery ||
      `${title} ${uploader}`.trim() === normalizedQuery ||
      `${uploaderId} ${title}`.trim() === normalizedQuery ||
      `${title} ${uploaderId}`.trim() === normalizedQuery
    ) {
      score += 180;
    }
    if (sameTokens(titleSet, querySet)) score += 140;
    if (sameTokens(combinedSet, querySet)) score += 130;
    if (titleCoverage === 1) score += 60;
    if (combinedCoverage === 1) score += 50;
    if (uploaderMatches > 0) score += Math.min(30, (uploaderMatches / queryTokens.length) * 40);
    score -= extraTitleTokens * 30;
    if (extraTitleTokens >= 3) score -= 40;

    diagnostic.score = relevanceScore(score);
    if (combinedCoverage < 1) diagnostic.reasons.push("missing_query_terms");
    if (score < SC_RELEVANCE_THRESHOLD) diagnostic.reasons.push("below_threshold");
    trace?.entries.push(diagnostic);
    if (!best || score > best.score) best = { score, url, diagnostic };
  }
  if (!sawPlayableEntry) throw new UserError(NO_PLAYABLE_SC);
  if (!best || best.score < SC_RELEVANCE_THRESHOLD) throw new UserError(NO_PRECISE_SC);
  best.diagnostic.decision = "accepted";
  if (trace) {
    trace.selected = {
      index: best.diagnostic.index,
      title: best.diagnostic.title,
      uploader: best.diagnostic.uploader,
    };
    trace.selectedScore = relevanceScore(best.score);
  }
  return best.url;
}

/** Function that runs a yt-dlp query and resolves its parsed JSON (injected for tests). */
export type YtDlpJsonFn = (query: string) => Promise<unknown>;

/**
 * Pre-resolves a SoundCloud text search to a concrete track URL. DisTube only
 * routes http(s) URLs to the yt-dlp plugin, so a bare `scsearch1:` search must
 * be resolved here first, then the resulting URL handed to `distube.play()`.
 * Bounded by `timeoutMs`; any yt-dlp failure is logged sanitised (never cookies
 * or signed URLs) and surfaced as a clean UserError.
 */
export async function resolveSoundcloudSearch(
  text: string,
  fetchJson: YtDlpJsonFn,
  timeoutMs: number = SC_SEARCH_TIMEOUT_MS,
): Promise<string> {
  let info: unknown;
  try {
    info = await withTimeout(
      fetchJson(`scsearch${SC_SEARCH_RESULTS}:${text}`),
      timeoutMs,
      () => new UserError("⏱️ La recherche SoundCloud a mis trop de temps. Réessaie."),
    );
  } catch (err) {
    if (err instanceof UserError) throw err; // timeout → shown to the user as-is
    console.error(`soundcloud search failed: ${sanitizeMedia(errMsg(err), 300)}`);
    throw new UserError(NO_SC_RESULT);
  }
  const trace: SoundcloudRelevanceTrace = {
    query: normalizeSoundcloudText(sanitizeRelevanceField(text, 160)),
    entriesReceived: 0,
    entries: [],
    selected: null,
    selectedScore: null,
    threshold: SC_RELEVANCE_THRESHOLD,
  };
  const rankingStartedAt = performance.now();
  try {
    const selectedUrl = pickPlayableSoundcloudUrl(info, text, trace);
    console.log(
      JSON.stringify({
        event: "soundcloud_search_relevance",
        ...trace,
        rankingMs: relevanceScore(performance.now() - rankingStartedAt),
      }),
    );
    return selectedUrl;
  } catch (err) {
    console.log(
      JSON.stringify({
        event: "soundcloud_search_relevance",
        ...trace,
        rankingMs: relevanceScore(performance.now() - rankingStartedAt),
      }),
    );
    if (err instanceof UserError) {
      console.log(
        JSON.stringify({
          event: "soundcloud_search_relevance_user_error",
          query: trace.query,
          message: sanitizeRelevanceField(err.message, 200),
        }),
      );
    }
    throw err;
  }
}

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
