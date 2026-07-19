import type { MusicStateDto } from "@bot/shared";

export const MUSIC_ACTIVE_POLL_MS = 2_000;
export const MUSIC_PAUSED_POLL_MS = 3_000;
export const MUSIC_IDLE_FAST_POLL_MS = 2_000;
export const MUSIC_IDLE_WARM_POLL_MS = 4_000;
export const MUSIC_IDLE_POLL_MS = 6_000;
export const MUSIC_BUFFERING_POLL_MS = 1_000;
export const MUSIC_IDLE_FAST_WINDOW_MS = 30_000;
export const MUSIC_IDLE_WARM_WINDOW_MS = 120_000;

/** Adaptive KV polling: briefly detects Discord actions, then backs off while idle. */
export function musicPollInterval(
  state: MusicStateDto | undefined,
  failedAttempts = 0,
  idleForMs = 0,
): number {
  if (failedAttempts > 0) return Math.min(12_000, 2_000 * 2 ** Math.min(failedAttempts, 3));
  if (!state) return MUSIC_ACTIVE_POLL_MS;
  if (state.status === "buffering") return MUSIC_BUFFERING_POLL_MS;
  if (state.status === "playing") return MUSIC_ACTIVE_POLL_MS;
  if (state.status === "paused") return MUSIC_PAUSED_POLL_MS;
  if (idleForMs < MUSIC_IDLE_FAST_WINDOW_MS) return MUSIC_IDLE_FAST_POLL_MS;
  if (idleForMs < MUSIC_IDLE_WARM_WINDOW_MS) return MUSIC_IDLE_WARM_POLL_MS;
  return MUSIC_IDLE_POLL_MS;
}

/** Each tab independently rejects a delayed KV response older than its snapshot. */
export function newestMusicState(
  current: MusicStateDto | undefined,
  incoming: MusicStateDto,
): MusicStateDto {
  if (!current) return incoming;
  if (incoming.sequence !== current.sequence) return incoming.sequence > current.sequence ? incoming : current;
  return incoming.updatedAt >= current.updatedAt ? incoming : current;
}

/** Browser-only interpolation; the server remains authoritative at every poll. */
export function interpolateMusicElapsed(state: MusicStateDto, millisecondsSinceReceipt: number): number {
  const advanced = state.status === "playing"
    ? state.elapsed + Math.max(0, millisecondsSinceReceipt) / 1_000
    : state.elapsed;
  const duration = state.current?.duration ?? 0;
  return duration > 0 ? Math.min(duration, advanced) : advanced;
}
