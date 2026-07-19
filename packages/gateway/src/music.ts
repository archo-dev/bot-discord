/** Musique — factory DisTube + ré-exports (le détail vit dans ./music/). */

import { DisTube, Playlist, type ResolveOptions, type Song } from "distube";
import { YtDlpPlugin } from "@distube/yt-dlp";
import { SpotifyPlugin } from "@distube/spotify";
import type { Client } from "discord.js";
import type { WorkerApi } from "./worker-api.js";
import { MusicController } from "./music/controller.js";

export { MusicController } from "./music/controller.js";
export { UserError, type PrimarySource } from "./music/format.js";

import type { PrimarySource } from "./music/format.js";

function hasStructuralSongs(value: unknown): value is { songs: unknown[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { songs?: unknown }).songs));
}

/**
 * Bridges @distube/yt-dlp's CommonJS Playlist class to the ESM Playlist class
 * used by this Gateway. This is a local object conversion only: super.resolve
 * remains the single yt-dlp call and individual song streams stay lazy.
 */
export class GatewayYtDlpPlugin extends YtDlpPlugin {
  override async resolve<T>(url: string, options: ResolveOptions<T>): Promise<Song<T> | Playlist<T>> {
    const resolved = await super.resolve(url, options);
    if (resolved instanceof Playlist || !hasStructuralSongs(resolved)) return resolved;

    const playlist = resolved as unknown as Playlist<T>;
    return new Playlist<T>(
      {
        source: playlist.source,
        songs: playlist.songs,
        id: playlist.id,
        name: playlist.name,
        url: playlist.url,
        thumbnail: playlist.thumbnail,
      },
      { member: playlist.member, metadata: playlist.metadata },
    );
  }
}

export function registerMusic(client: Client, api: WorkerApi, primarySource: PrimarySource = "youtube"): MusicController {
  const distube = new DisTube(client, {
    // YtDlpPlugin is the fallback extractor and must be LAST: SpotifyPlugin
    // rewrites Spotify links into searches that yt-dlp then resolves. yt-dlp
    // also natively resolves SoundCloud URLs and scsearch: queries.
    plugins: [new SpotifyPlugin(), new GatewayYtDlpPlugin({ update: false })],
    emitNewSongOnly: true,
    savePreviousSongs: false,
  });
  const controller = new MusicController(client, distube, api, primarySource);
  controller.registerEvents();
  return controller;
}
