/** Music DTOs (M14), shared by the Worker, the panel and the gateway (DisTube). */

export interface MusicTrack {
  title: string;
  url: string;
  /** Seconds; 0 for live streams. */
  duration: number;
  thumbnail: string | null;
  requestedBy: string | null;
}

/** Live playback snapshot published by the gateway to KV (short TTL). */
export interface MusicStateDto {
  connected: boolean;
  paused: boolean;
  current: MusicTrack | null;
  /** Seconds elapsed in the current track. */
  elapsed: number;
  queue: MusicTrack[];
  loop: "off" | "song" | "queue";
  volume: number;
  voiceChannelId: string | null;
  updatedAt: number;
}

export const EMPTY_MUSIC_STATE: MusicStateDto = {
  connected: false,
  paused: false,
  current: null,
  elapsed: 0,
  queue: [],
  loop: "off",
  volume: 100,
  voiceChannelId: null,
  updatedAt: 0,
};

export interface PlaylistSummaryDto {
  name: string;
  ownerId: string;
  trackCount: number;
  createdAt: string;
}

export type MusicCommand =
  | "play"
  | "pause"
  | "resume"
  | "skip"
  | "stop"
  | "queue"
  | "remove"
  | "shuffle"
  | "loop"
  | "volume"
  | "seek"
  | "nowplaying"
  | "playlist_save"
  | "playlist_load";

/** Forwarded Worker → gateway (bearer GATEWAY_HTTP_TOKEN) to run a music action. */
export interface MusicCommandPayload {
  command: MusicCommand;
  guildId: string;
  userId: string;
  textChannelId: string;
  /** Interaction webhook target; null for panel-originated controls. */
  applicationId: string | null;
  token: string | null;
  /** Command argument (query, level, seconds, playlist name); parsed per command. */
  arg: string | null;
  source: "interaction" | "panel";
}
