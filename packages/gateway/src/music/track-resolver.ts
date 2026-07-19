import { DisTubeError, Playlist, type DisTube, type ResolveOptions, type Song } from "distube";
import type { MusicSearchResultDto } from "@bot/shared";
import { getSoundcloudPlaybackMetadata, getSoundcloudPlaylistSummary } from "./soundcloud-playback.js";
import { resolvePlayQuery, UserError, withTimeout, type PrimarySource, type ResolvedQuery } from "./format.js";
import type { MusicActionContext } from "./instrumentation.js";

export const PANEL_SEARCH_TIMEOUT_MS = 15_000;

export interface ResolvedTrackInput extends ResolvedQuery {
  /** Concrete URL/query handed to DisTube after the primary-source routing. */
  playQuery: string;
}

export interface TrackSearchPreview {
  input: ResolvedTrackInput;
  result: MusicSearchResultDto;
}

type SoundcloudTextResolver = (query: string, action: MusicActionContext) => Promise<string>;

function publicWebUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function previewForSong(song: Song): boolean | null {
  return getSoundcloudPlaybackMetadata(song.metadata, song.id)?.isPreview ?? null;
}

function describeResolved(media: Song | Playlist): MusicSearchResultDto {
  if (media instanceof Playlist) {
    const first = media.songs[0];
    const summary = getSoundcloudPlaylistSummary(media.metadata);
    const previewCount = media.songs.filter((song) => previewForSong(song) === true).length;
    return {
      title: media.name?.trim() || "Playlist sans titre",
      author: first?.uploader?.name?.trim() || null,
      duration: Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0,
      thumbnail: publicWebUrl(media.thumbnail ?? first?.thumbnail),
      url: publicWebUrl(media.url),
      type: "playlist",
      isPreview: previewCount > 0 ? true : null,
      playableTrackCount: media.songs.length,
      ignoredTrackCount: Math.max(0, summary?.ignored ?? 0),
    };
  }
  return {
    title: media.name?.trim() || "Piste sans titre",
    author: media.uploader?.name?.trim() || null,
    duration: Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0,
    thumbnail: publicWebUrl(media.thumbnail),
    url: publicWebUrl(media.url),
    type: "track",
    isPreview: previewForSong(media),
    playableTrackCount: 1,
    ignoredTrackCount: 0,
  };
}

/**
 * Single Gateway-owned routing/resolution layer shared by Discord playback and
 * panel search. The Worker never invokes yt-dlp and this class never resolves
 * stream URLs: DisTube keeps getStreamURL() lazy until actual playback.
 */
export class TrackResolver {
  constructor(
    private readonly distube: DisTube,
    private readonly primarySource: PrimarySource,
    private readonly resolveSoundcloudText: SoundcloudTextResolver,
  ) {}

  async resolveInput(raw: string, action: MusicActionContext): Promise<ResolvedTrackInput> {
    const routed = resolvePlayQuery(raw, this.primarySource);
    const playQuery = routed.soundcloudSearch
      ? await this.resolveSoundcloudText(routed.query, action)
      : routed.query;
    return { ...routed, playQuery };
  }

  async search(
    raw: string,
    action: MusicActionContext,
    options: ResolveOptions = {},
  ): Promise<TrackSearchPreview> {
    const operation = (async () => {
      const input = await this.resolveInput(raw, action);
      const media = await this.distube.handler.resolve(input.playQuery, options);
      return { input, result: describeResolved(media) };
    })();
    try {
      return await withTimeout(
        operation,
        PANEL_SEARCH_TIMEOUT_MS,
        () => new UserError("⏱️ La recherche a mis trop de temps. Réessaie avec un lien direct."),
      );
    } catch (error) {
      if (error instanceof UserError) throw error;
      const code = error instanceof DisTubeError ? error.code : undefined;
      if (code && ["NO_RESULT", "NOT_SUPPORTED_URL", "CANNOT_RESOLVE_SONG", "YTDLP_ERROR"].includes(code)) {
        throw new UserError("⚠️ Aucun résultat complet et exploitable n’a été trouvé.");
      }
      throw error;
    }
  }
}
