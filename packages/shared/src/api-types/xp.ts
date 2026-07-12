/** XP/levels settings + leaderboard DTOs (gains detected by the gateway, computed by the Worker). */

export interface XpRewardDto {
  level: number;
  roleId: string;
}

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
