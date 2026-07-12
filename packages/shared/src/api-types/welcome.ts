/** Welcome/leave messages, applied by the gateway on member join/leave. */

export interface WelcomeSettingsDto {
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeMessage: string;
  leaveEnabled: boolean;
  leaveChannelId: string | null;
  leaveMessage: string;
}
