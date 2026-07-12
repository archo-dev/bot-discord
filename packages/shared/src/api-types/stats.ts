/** Guild stats DTOs (M19): member snapshots, channel activity, presence, events. */

export interface MemberSnapshotPoint {
  /** 'YYYY-MM-DDTHH:00' (UTC). */
  bucket: string;
  total: number;
  humans: number;
  bots: number;
}

export interface MemberDeltaPoint {
  /** 'YYYY-MM-DD' (UTC). */
  day: string;
  joins: number;
  leaves: number;
}

export interface MemberStatsDto {
  snapshots: MemberSnapshotPoint[];
  deltas: MemberDeltaPoint[];
}

export interface ChannelStatEntry {
  channelId: string;
  value: number;
}

export interface ChannelStatsDto {
  /** Top channels by message count over the window. */
  topMessages: ChannelStatEntry[];
  /** Top channels by voice seconds over the window. */
  topVoice: ChannelStatEntry[];
}

/** Presence counts, or null when the Presence intent is off / gateway is down. */
export interface PresenceStatsDto {
  online: number;
  idle: number;
  dnd: number;
  offline: number;
}

export interface ScheduledEventDto {
  id: string;
  name: string;
  description: string | null;
  scheduledStartTime: string;
  scheduledEndTime: string | null;
  /** Voice/stage channel id, or null for external events. */
  channelId: string | null;
  /** External-event location, if any. */
  location: string | null;
  interestedCount: number | null;
}
