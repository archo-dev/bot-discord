/** Server event logs + voice logs (M17) DTOs. */

/** Server event logs, posted by the gateway as embeds. */
export interface LogSettingsDto {
  channelId: string | null;
  memberJoin: boolean;
  memberLeave: boolean;
  messageDelete: boolean;
  messageEdit: boolean;
  memberUpdate: boolean;
  /** Voice log-channel embeds (M17). Persistence of join/leave/move is independent of these. */
  voiceJoin: boolean;
  voiceLeave: boolean;
  voiceMove: boolean;
  /** Mute/unmute/deafen/undeafen — gates both the embed AND the D1 persistence. */
  voiceState: boolean;
}

export type VoiceLogAction = "join" | "leave" | "move" | "mute" | "unmute" | "deafen" | "undeafen";

/** One voice activity entry (M17). */
export interface VoiceLogDto {
  id: number;
  userId: string;
  userTag: string | null;
  action: VoiceLogAction;
  channelId: string | null;
  fromChannelId: string | null;
  createdAt: string;
}

/** Keyset-paginated voice log page; `nextCursor` is null on the last page. */
export interface VoiceLogPage {
  items: VoiceLogDto[];
  nextCursor: string | null;
}
