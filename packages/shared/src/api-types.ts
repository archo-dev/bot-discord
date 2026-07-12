/** Request/response types shared between the panel SPA and the Worker API. */

import type { CommandLogic } from "./command-logic.js";

export interface MeResponse {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

export interface GuildSummary {
  id: string;
  name: string;
  icon: string | null;
  /** How the user got panel access. */
  access: "manage_guild" | "panel_grant";
}

export interface GuildOverview {
  id: string;
  name: string;
  icon: string | null;
  approximateMemberCount: number | null;
  logChannelId: string | null;
  warnThreshold: number;
  warnTimeoutMinutes: number;
  /** Bot's custom nickname on this guild (M16); null = default username. */
  customNickname: string | null;
  /** Append a member card to bot messages that mention users (M20, opt-in). */
  mentionCards: boolean;
  /** True while the gateway heartbeat is fresh (< 5 min, KV `gateway:status`). */
  gatewayConnected: boolean;
  /** Panel permission tier of the requesting user: moderators are read-only. */
  access: "admin" | "moderator";
}

export interface GuildConfigPatch {
  logChannelId?: string | null;
  warnThreshold?: number;
  warnTimeoutMinutes?: number;
  mentionCards?: boolean;
}

export interface ChannelOption {
  id: string;
  name: string;
  type: number;
  position: number;
}

/**
 * A Discord member resolved for display (UserCell) and member search.
 * `resolve` returns only ids it could resolve — callers fall back to the
 * degraded ID display for anything missing.
 */
export interface ResolvedMember {
  id: string;
  /** Guild nickname > global name > username. */
  displayName: string;
  username: string;
  /** Full CDN URL (guild avatar > user avatar > default), always set. */
  avatarUrl: string;
  bot: boolean;
  /** False when the user is no longer in the guild (resolved via /users). */
  inGuild: boolean;
}

export interface RoleOption {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

export interface CustomCommandDto {
  id: number;
  guildId: string;
  name: string;
  description: string;
  triggerType: "slash" | "keyword";
  enabled: boolean;
  logic: CommandLogic;
  cooldownSeconds: number;
  cooldownScope: "user" | "guild";
  requiredPermissions: string | null;
  discordCommandId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
  /** True when the trigger needs the (not yet deployed) gateway service. */
  gatewayRequired: boolean;
}

export interface CustomCommandUpsert {
  name: string;
  description: string;
  logic: CommandLogic;
}

export interface CommandRevisionDto {
  id: number;
  commandId: number;
  changeType: "create" | "update" | "enable" | "disable" | "delete";
  logic: CommandLogic;
  changedBy: string;
  changedAt: string;
}

export interface ModActionDto {
  id: number;
  action: string;
  targetId: string | null;
  moderatorId: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  source: "interaction" | "panel" | "gateway";
  createdAt: string;
}

export interface WarningDto {
  id: number;
  userId: string;
  moderatorId: string;
  reason: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface PanelAccessEntry {
  id: number;
  subjectType: "role" | "user";
  subjectId: string;
  /** admin = full access, moderator = read-only panel. */
  level: "admin" | "moderator";
  addedBy: string;
  createdAt: string;
}

export interface AutoRoleEntry {
  roleId: string;
  enabled: boolean;
  /** Applied by the gateway service on member join. */
  gatewayRequired: true;
}

/** Welcome/leave messages, applied by the gateway on member join/leave. */
export interface WelcomeSettingsDto {
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeMessage: string;
  leaveEnabled: boolean;
  leaveChannelId: string | null;
  leaveMessage: string;
}

/** Auto-moderation rules, enforced by the gateway on each message. */
export interface AutomodSettingsDto {
  antiSpamEnabled: boolean;
  antiSpamMaxMessages: number;
  antiSpamWindowSeconds: number;
  antiInviteEnabled: boolean;
  antiLinkEnabled: boolean;
  /** Domains allowed even with anti-link on (suffix match). */
  linkWhitelist: string[];
  bannedWords: string[];
  exemptRoleIds: string[];
  exemptChannelIds: string[];
  /** delete = silent removal; warn/timeout also insert warnings/mod_actions. */
  action: "delete" | "warn" | "timeout";
  timeoutMinutes: number;
}

export interface XpRewardDto {
  level: number;
  roleId: string;
}

/** XP/levels settings; gains are detected by the gateway, computed by the Worker. */
export interface XpSettingsDto {
  enabled: boolean;
  xpMin: number;
  xpMax: number;
  cooldownSeconds: number;
  announceLevelUp: boolean;
  /** null = announce in the channel the message was sent in. */
  announceChannelId: string | null;
  rewards: XpRewardDto[];
  /** Voice XP (M22): earn XP per minute spent in a voice channel. */
  voiceEnabled: boolean;
  voiceXpPerMin: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string | null;
  xp: number;
  level: number;
  messages: number;
  /** Minutes spent in voice that earned XP (M22). */
  voiceMinutes: number;
}

// --- Music (M14) -----------------------------------------------------------

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

export interface TicketSettingsDto {
  enabled: boolean;
  categoryId: string | null;
  staffRoleIds: string[];
  transcriptChannelId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
}

export interface TicketSettingsUpdate {
  enabled: boolean;
  categoryId: string | null;
  staffRoleIds: string[];
  transcriptChannelId: string | null;
}

export interface TicketDto {
  id: number;
  number: number;
  channelId: string;
  userId: string;
  status: "open" | "closed";
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
  hasTranscript: boolean;
}

export interface ButtonRoleDto {
  id: number;
  roleId: string;
  label: string;
  emoji: string | null;
  /** Discord button style: 1 primary, 2 secondary, 3 success, 4 danger. */
  style: number;
}

export interface ButtonRoleMessageDto {
  id: number;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string | null;
  createdAt: string;
  buttons: ButtonRoleDto[];
}

export interface ButtonRoleMessageCreate {
  channelId: string;
  title: string;
  description: string | null;
  buttons: Array<{ roleId: string; label: string; emoji: string | null; style: number }>;
}

// --- Stats (M19) -----------------------------------------------------------

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

export interface ApiError {
  error: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
