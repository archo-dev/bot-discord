/** Discord entity options resolved by the Worker for panel selects/cells. */

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
