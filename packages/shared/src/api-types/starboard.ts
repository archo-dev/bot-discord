/** Starboard settings (M23): ⭐-reaction best-of channel. */

export interface StarboardSettingsDto {
  enabled: boolean;
  /** null = not configured (feature inert). */
  channelId: string | null;
  threshold: number;
  /** Unicode emoji (default ⭐) or a custom emoji id/tag. */
  emoji: string;
}
