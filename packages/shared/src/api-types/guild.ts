/** Auth/session + guild overview/config DTOs (panel <-> Worker). */

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
