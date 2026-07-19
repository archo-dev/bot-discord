/** Music DTOs (M14), shared by the Worker, the panel and the gateway (DisTube). */

import { z } from "zod";

export type MusicPlaybackStatus = "idle" | "buffering" | "playing" | "paused" | "stopped" | "error";

export interface MusicTrack {
  title: string;
  url: string;
  /** Seconds; 0 for live streams. */
  duration: number;
  thumbnail: string | null;
  requestedBy: string | null;
  /** Explicit yt-dlp preview classification when available. */
  isPreview?: boolean | null;
  previewReason?: string | null;
  isLive?: boolean;
}

/** Live playback snapshot published by the gateway to KV (short TTL). */
export interface MusicStateDto {
  status: MusicPlaybackStatus;
  connected: boolean;
  paused: boolean;
  seekable: boolean;
  current: MusicTrack | null;
  /** Seconds elapsed in the current track. */
  elapsed: number;
  queue: MusicTrack[];
  loop: "off" | "song" | "queue";
  volume: number;
  voiceChannelId: string | null;
  /** Timestamp-based monotone sequence used to reject stale KV responses. */
  sequence: number;
  updatedAt: number;
}

export const EMPTY_MUSIC_STATE: MusicStateDto = {
  status: "idle",
  connected: false,
  paused: false,
  seekable: false,
  current: null,
  elapsed: 0,
  queue: [],
  loop: "off",
  volume: 100,
  voiceChannelId: null,
  sequence: 0,
  updatedAt: 0,
};

const musicTrackSchema = z.object({
  title: z.string().max(300),
  url: z.string().max(500),
  duration: z.number().finite().nonnegative(),
  thumbnail: z.string().max(500).nullable(),
  requestedBy: z.string().max(32).nullable(),
  isPreview: z.boolean().nullable().optional(),
  previewReason: z.string().max(80).nullable().optional(),
  isLive: z.boolean().optional(),
});

const musicStateInputSchema = z.object({
  status: z.enum(["idle", "buffering", "playing", "paused", "stopped", "error"]).optional(),
  connected: z.boolean(),
  paused: z.boolean(),
  seekable: z.boolean().optional(),
  current: musicTrackSchema.nullable(),
  elapsed: z.number().finite().nonnegative(),
  queue: z.array(musicTrackSchema).max(200),
  loop: z.enum(["off", "song", "queue"]),
  volume: z.number().finite().min(0).max(200),
  voiceChannelId: z.string().max(32).nullable(),
  sequence: z.number().int().nonnegative().optional(),
  updatedAt: z.number().finite().nonnegative(),
});

/**
 * Accepts pre-Phase-4 snapshots during rolling deploys and returns the current
 * shape. New snapshots carry an explicit status and monotone sequence.
 */
export const MusicStateSchema = musicStateInputSchema.transform((value): MusicStateDto => {
  const status = value.status ??
    (!value.connected ? "idle" : value.paused ? "paused" : value.current ? "playing" : "idle");
  return {
    ...value,
    status,
    seekable: value.seekable ?? Boolean(
      value.current && value.current.duration > 0 && !value.current.isLive && value.current.isPreview !== true,
    ),
    sequence: value.sequence ?? Math.floor(value.updatedAt),
  };
});

export const MusicControlRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["pause", "resume", "skip", "stop", "shuffle"]) }).strict(),
  z.object({ action: z.literal("volume"), value: z.number().int().min(0).max(150) }).strict(),
  z.object({ action: z.literal("repeat"), mode: z.enum(["off", "song", "queue"]).nullable() }).strict(),
  z.object({ action: z.literal("remove"), position: z.number().int().min(1).max(200) }).strict(),
]);

export type MusicControlRequest = z.infer<typeof MusicControlRequestSchema>;

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
