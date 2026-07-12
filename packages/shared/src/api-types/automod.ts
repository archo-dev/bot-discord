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
