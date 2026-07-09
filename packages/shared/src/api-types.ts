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
  /** True while the gateway heartbeat is fresh (< 3 min, KV `gateway:status`). */
  gatewayConnected: boolean;
}

export interface GuildConfigPatch {
  logChannelId?: string | null;
  warnThreshold?: number;
  warnTimeoutMinutes?: number;
}

export interface ChannelOption {
  id: string;
  name: string;
  type: number;
  position: number;
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
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string | null;
  xp: number;
  level: number;
  messages: number;
}

/** Server event logs, posted by the gateway as embeds. */
export interface LogSettingsDto {
  channelId: string | null;
  memberJoin: boolean;
  memberLeave: boolean;
  messageDelete: boolean;
  messageEdit: boolean;
  memberUpdate: boolean;
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

export interface ApiError {
  error: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
