/** Musique — factory DisTube + ré-exports (le détail vit dans ./music/). */

import { DisTube } from "distube";
import { YtDlpPlugin } from "@distube/yt-dlp";
import { SpotifyPlugin } from "@distube/spotify";
import type { Client } from "discord.js";
import type { WorkerApi } from "./worker-api.js";
import { MusicController } from "./music/controller.js";

export { MusicController } from "./music/controller.js";
export { UserError, type PrimarySource } from "./music/format.js";

import type { PrimarySource } from "./music/format.js";

export function registerMusic(client: Client, api: WorkerApi, primarySource: PrimarySource = "youtube"): MusicController {
  const distube = new DisTube(client, {
    // YtDlpPlugin is the fallback extractor and must be LAST: SpotifyPlugin
    // rewrites Spotify links into searches that yt-dlp then resolves. yt-dlp
    // also natively resolves SoundCloud URLs and scsearch: queries.
    plugins: [new SpotifyPlugin(), new YtDlpPlugin({ update: false })],
    emitNewSongOnly: true,
    savePreviousSongs: false,
  });
  const controller = new MusicController(client, distube, api, primarySource);
  controller.registerEvents();
  return controller;
}
