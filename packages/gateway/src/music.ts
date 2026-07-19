/** Musique — factory DisTube + ré-exports (le détail vit dans ./music/). */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DisTube, DisTubeError, Playlist, Song, type ResolveOptions } from "distube";
import { YtDlpPlugin } from "@distube/yt-dlp";
import { SpotifyPlugin } from "@distube/spotify";
import type { Client } from "discord.js";
import type { WorkerApi } from "./worker-api.js";
import { MusicController } from "./music/controller.js";
import { MusicInstrumentation } from "./music/instrumentation.js";

export { MusicController } from "./music/controller.js";
export { UserError, type PrimarySource } from "./music/format.js";

import type { PrimarySource } from "./music/format.js";

function hasStructuralSongs(value: unknown): value is { songs: unknown[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { songs?: unknown }).songs));
}

interface YtDlpSetInfo {
  _type?: string;
  extractor?: string;
  id?: string | number;
  title?: string;
  webpage_url?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string }>;
  entries?: Array<YtDlpTrackInfo | null>;
}

interface YtDlpTrackInfo {
  extractor?: string;
  id?: string | number;
  title?: string;
  fulltitle?: string;
  webpage_url?: string;
  original_url?: string;
  is_live?: boolean;
  duration?: number;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string }>;
  uploader?: string;
  uploader_url?: string;
  view_count?: number;
  like_count?: number;
  dislike_count?: number;
  repost_count?: number;
  age_limit?: number;
}

export type SoundcloudSetJsonResolver = (url: string) => Promise<unknown>;

const require = createRequire(import.meta.url);

function isSoundcloudSetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    return (host === "soundcloud.com" || host === "www.soundcloud.com" || host === "m.soundcloud.com") &&
      parts.length >= 3 && parts[1]?.toLowerCase() === "sets";
  } catch {
    return false;
  }
}

function ytDlpExecutable(): string {
  const filename = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const configuredDir = process.env.YTDLP_DIR?.trim();
  if (configuredDir) return join(configuredDir, filename);
  const packageEntry = require.resolve("@distube/yt-dlp");
  return join(dirname(packageEntry), "..", "bin", filename);
}

/**
 * Extracts a SoundCloud set once while retaining valid stdout when yt-dlp exits
 * non-zero because individual DRM entries were skipped by --ignore-errors.
 */
async function extractSoundcloudSetJson(url: string): Promise<unknown> {
  const args = [
    url,
    "--dump-single-json",
    "--no-warnings",
    "--prefer-free-formats",
    "--skip-download",
    "--simulate",
    "--ignore-errors",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpExecutable(), args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      try {
        resolve(parseSoundcloudSetOutput(stdout, stderr, code));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function parseSoundcloudSetOutput(stdout: string, stderr: string, code: number | null): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    const detail = stderr
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1_000);
    throw new DisTubeError("YTDLP_ERROR", detail || `yt-dlp exited ${code ?? "unknown"} without valid JSON`);
  }
}

function isYtDlpSetInfo(value: unknown): value is YtDlpSetInfo & { entries: Array<YtDlpTrackInfo | null> } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as YtDlpSetInfo).entries));
}

function normalizedYtDlpSong<T>(plugin: GatewayYtDlpPlugin, info: YtDlpTrackInfo, options: ResolveOptions<T>): Song<T> | null {
  const id = info.id == null ? "" : String(info.id);
  const name = info.title || info.fulltitle;
  const url = info.webpage_url || info.original_url;
  if (!id || !name || !url) return null;
  return new Song<T>(
    {
      plugin,
      source: info.extractor ?? "soundcloud",
      playFromSource: true,
      id,
      name,
      url,
      isLive: info.is_live,
      duration: info.is_live ? 0 : info.duration,
      thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
      uploader: { name: info.uploader, url: info.uploader_url },
      views: info.view_count,
      likes: info.like_count,
      dislikes: info.dislike_count,
      reposts: info.repost_count,
      ageRestricted: (info.age_limit ?? 0) >= 18,
    },
    options,
  );
}

/**
 * Bridges @distube/yt-dlp's CommonJS Playlist and Song classes to the ESM
 * classes used by this Gateway. Non-set URLs retain the single super.resolve
 * call; SoundCloud sets use one tolerant yt-dlp extraction. Streams stay lazy.
 */
export class GatewayYtDlpPlugin extends YtDlpPlugin {
  constructor(
    options: { update?: boolean } = {},
    private readonly soundcloudSetJson: SoundcloudSetJsonResolver = extractSoundcloudSetJson,
  ) {
    super(options);
  }

  override async resolve<T>(url: string, options: ResolveOptions<T>): Promise<Song<T> | Playlist<T>> {
    if (isSoundcloudSetUrl(url)) {
      const info = await this.soundcloudSetJson(url);
      if (!isYtDlpSetInfo(info)) throw new DisTubeError("YTDLP_ERROR", "SoundCloud set did not return a playlist");
      const songs = info.entries
        .filter((entry): entry is YtDlpTrackInfo => entry !== null)
        .map((entry) => normalizedYtDlpSong(this, entry, options))
        .filter((song): song is Song<T> => song !== null);
      if (songs.length === 0) throw new DisTubeError("YTDLP_ERROR", "The playlist has no playable entries");
      return new Playlist<T>(
        {
          source: info.extractor ?? "soundcloud",
          songs,
          id: info.id == null ? undefined : String(info.id),
          name: info.title,
          url: info.webpage_url ?? url,
          thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
        },
        options,
      );
    }

    const resolved = await super.resolve(url, options);
    if (resolved instanceof Playlist || !hasStructuralSongs(resolved)) return resolved;

    const playlist = resolved as unknown as Playlist<T>;
    const songs = playlist.songs.map((rawSong) => {
      const song = rawSong as Song<T>;
      return new Song<T>(
        {
          plugin: song.plugin,
          source: song.source,
          playFromSource: song.stream.playFromSource,
          id: song.id,
          name: song.name,
          isLive: song.isLive,
          duration: song.duration,
          url: song.url,
          thumbnail: song.thumbnail,
          views: song.views,
          likes: song.likes,
          dislikes: song.dislikes,
          reposts: song.reposts,
          uploader: song.uploader,
          ageRestricted: song.ageRestricted,
        },
        { member: song.member, metadata: song.metadata },
      );
    });
    return new Playlist<T>(
      {
        source: playlist.source,
        songs,
        id: playlist.id,
        name: playlist.name,
        url: playlist.url,
        thumbnail: playlist.thumbnail,
      },
      { member: playlist.member, metadata: playlist.metadata },
    );
  }
}

export function registerMusic(
  client: Client,
  api: WorkerApi,
  primarySource: PrimarySource = "youtube",
  instrumentationSecret?: string,
): MusicController {
  const distube = new DisTube(client, {
    // YtDlpPlugin is the fallback extractor and must be LAST: SpotifyPlugin
    // rewrites Spotify links into searches that yt-dlp then resolves. yt-dlp
    // also natively resolves SoundCloud URLs and scsearch: queries.
    plugins: [new SpotifyPlugin(), new GatewayYtDlpPlugin({ update: false })],
    emitNewSongOnly: true,
    savePreviousSongs: false,
  });
  const controller = new MusicController(
    client,
    distube,
    api,
    primarySource,
    new MusicInstrumentation(instrumentationSecret),
  );
  controller.registerEvents();
  return controller;
}
