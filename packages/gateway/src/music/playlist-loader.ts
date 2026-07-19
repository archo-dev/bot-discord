import {
  Playlist,
  PluginType,
  Song,
  type DisTubePlugin,
  type ResolveOptions,
} from "distube";
import type { MusicTrack } from "@bot/shared";
import { errMsg } from "../util.js";
import { resolvePlayQuery, UserError, type PrimarySource } from "./format.js";

/** Hard memory/queue bound for one saved-playlist load operation. */
export const MAX_LAZY_PLAYLIST_TRACKS = 200;

export interface PlaylistLoadSession {
  readonly guildId: string;
  readonly actionId: string;
  readonly signal: AbortSignal;
  cancelled: boolean;
  cancelReason: string | null;
}

export interface LazyPlaylistBuildSummary {
  detected: number;
  validated: number;
  ignored: number;
  errors: number;
  truncated: number;
  buildDurationMs: number;
  firstError: string | null;
  maxConcurrentPromises: 0;
}

export interface LazyPlaylistBuild<T> {
  playlist: Playlist<T> | null;
  summary: LazyPlaylistBuildSummary;
}

interface BuildOptions<T> extends ResolveOptions<T> {
  name: string;
  primarySource: PrimarySource;
  plugins: readonly DisTubePlugin[];
}

export class PlaylistLoadCancelledError extends Error {
  constructor(readonly reason: string) {
    super(`Saved playlist load cancelled: ${reason}`);
  }
}

function lazyPlayablePlugin(plugins: readonly DisTubePlugin[]): DisTubePlugin {
  const plugin = [...plugins].reverse().find(
    (candidate) =>
      candidate.type === PluginType.PLAYABLE_EXTRACTOR &&
      "getStreamURL" in candidate &&
      typeof candidate.getStreamURL === "function",
  );
  if (!plugin) throw new Error("No playable extractor plugin is available for lazy playlist songs");
  return plugin;
}

function publicTrackUrl(raw: string, primarySource: PrimarySource): { url: string; source: string } | null {
  const resolved = resolvePlayQuery(raw, primarySource);
  if (resolved.soundcloudSearch) return null;

  let url: URL;
  try {
    url = new URL(resolved.query);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if ((host === "soundcloud.com" || host.endsWith(".soundcloud.com")) && /\/sets(?:\/|$)/i.test(url.pathname)) {
    return null;
  }
  return {
    url: resolved.query,
    source: resolved.source === "url" ? host : resolved.source,
  };
}

/**
 * Builds bounded ESM Song/Playlist objects from saved metadata only. It owns
 * no stream, timer or listener; the active map contains one scalar session per
 * guild and is cleared as soon as its controller operation settles.
 */
export class PlaylistLoader {
  private readonly active = new Map<string, PlaylistLoadSession>();
  private readonly abortControllers = new WeakMap<PlaylistLoadSession, AbortController>();

  start(guildId: string, actionId: string): PlaylistLoadSession {
    this.cancel(guildId, "superseded");
    const abortController = new AbortController();
    const session: PlaylistLoadSession = {
      guildId,
      actionId,
      signal: abortController.signal,
      cancelled: false,
      cancelReason: null,
    };
    this.abortControllers.set(session, abortController);
    this.active.set(guildId, session);
    return session;
  }

  cancel(guildId: string, reason: string): PlaylistLoadSession | null {
    const session = this.active.get(guildId);
    if (!session) return null;
    session.cancelled = true;
    session.cancelReason = reason;
    this.abortControllers.get(session)?.abort(reason);
    this.abortControllers.delete(session);
    this.active.delete(guildId);
    return session;
  }

  finish(session: PlaylistLoadSession): void {
    if (this.active.get(session.guildId) === session) this.active.delete(session.guildId);
    this.abortControllers.delete(session);
  }

  isActive(session: PlaylistLoadSession): boolean {
    return !session.cancelled && this.active.get(session.guildId) === session;
  }

  assertActive(session: PlaylistLoadSession): void {
    if (!this.isActive(session)) throw new PlaylistLoadCancelledError(session.cancelReason ?? "cancelled");
  }

  get activeCount(): number {
    return this.active.size;
  }

  build<T>(session: PlaylistLoadSession, tracks: readonly MusicTrack[], options: BuildOptions<T>): LazyPlaylistBuild<T> {
    const startedAt = performance.now();
    this.assertActive(session);
    const detected = tracks.length;
    const truncated = Math.max(0, detected - MAX_LAZY_PLAYLIST_TRACKS);
    const considered = tracks.slice(0, MAX_LAZY_PLAYLIST_TRACKS);
    const plugin = lazyPlayablePlugin(options.plugins);
    const songs: Song<T>[] = [];
    let ignored = 0;
    let errors = 0;
    let firstError: string | null = null;

    for (let index = 0; index < considered.length; index++) {
      this.assertActive(session);
      try {
        const track = considered[index];
        if (!track || typeof track.title !== "string" || !track.title.trim()) {
          ignored++;
          continue;
        }
        if (typeof track.url !== "string" || !track.url.trim()) {
          ignored++;
          continue;
        }
        if (typeof track.duration !== "number" || !Number.isFinite(track.duration) || track.duration < 0) {
          ignored++;
          continue;
        }
        const resolved = publicTrackUrl(track.url, options.primarySource);
        if (!resolved) {
          ignored++;
          continue;
        }

        songs.push(
          new Song<T>(
            {
              plugin,
              source: resolved.source,
              playFromSource: true,
              id: `saved:${index}:${resolved.url}`,
              name: track.title.trim(),
              isLive: track.duration === 0,
              duration: track.duration,
              url: resolved.url,
              thumbnail: track.thumbnail ?? undefined,
              ageRestricted: false,
            },
            { member: options.member, metadata: options.metadata },
          ),
        );
      } catch (error) {
        if (error instanceof UserError) {
          ignored++;
          continue;
        }
        errors++;
        firstError ??= String(errMsg(error));
      }
    }

    this.assertActive(session);
    const playlist = songs.length
      ? new Playlist<T>(
          {
            source: "saved",
            songs,
            id: `saved:${session.actionId}`,
            name: options.name,
            thumbnail: songs.find((song) => song.thumbnail)?.thumbnail,
          },
          { member: options.member, metadata: options.metadata },
        )
      : null;

    return {
      playlist,
      summary: {
        detected,
        validated: songs.length,
        ignored,
        errors,
        truncated,
        buildDurationMs: performance.now() - startedAt,
        firstError,
        maxConcurrentPromises: 0,
      },
    };
  }
}
