/**
 * Voice XP eligibility (anti-farm) — pure, side-effect-free decision layer.
 *
 * The gateway grants voice XP once a minute to every member currently *eligible*
 * in a voice channel (amounts/curve stay Worker-side). This module owns the
 * "who is eligible" rule so it can be unit-tested in isolation from discord.js.
 *
 * A member earns XP only when a real conversation is happening around them:
 *   - connected to a voice channel (not the AFK channel),
 *   - not a bot,
 *   - not muted or deafened (self OR server),
 *   - the Levels module is enabled and correctly configured,
 *   - AND at least one OTHER *active* human shares the channel.
 *
 * "Active" reuses the same self-checks: a muted/deafened human, a bot, or a
 * member with an invalid state does NOT count as a conversation partner. So two
 * humans alone where one is deafened = nobody earns (the historic farm bug: the
 * old `humans.size >= 2` check counted muted/deafened humans as participants).
 *
 * The decision is stateless and re-evaluated every tick from the live voice
 * state: an ineligible window simply yields no grant that tick — never a
 * retroactive grant, a ghost session, a double count, or a post-disconnect gain.
 */

/** Reasons a member is (in)eligible. Closed enum — safe to log/aggregate. */
export type VoiceXpReason =
  | "ELIGIBLE"
  | "NOT_IN_VOICE"
  | "USER_IS_BOT"
  | "SELF_MUTED"
  | "SELF_DEAFENED"
  | "SERVER_MUTED"
  | "SERVER_DEAFENED"
  | "ALONE"
  | "BOTS_ONLY"
  | "AFK_CHANNEL"
  | "LEVELS_DISABLED"
  | "LEVELS_MISCONFIGURED"
  | "MISSING_GUILD"
  | "MISSING_MEMBER"
  | "GATEWAY_STATE_INCOMPLETE";

/** Minimal voice state of a channel member — plain data, no discord.js coupling. */
export interface VoiceMemberState {
  userId: string;
  isBot: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
}

export interface VoiceXpContext {
  /** Levels module enabled AND voice XP enabled for this guild. */
  levelsEnabled: boolean;
  /** Guild config present and structurally usable (false → misconfigured). */
  levelsConfigured: boolean;
  /** The guild's official AFK channel, if any. */
  afkChannelId: string | null;
  /** Channel the target currently sits in (null → not connected). */
  channelId: string | null;
  /** Everyone currently in `channelId`, target included. Dupes/invalids tolerated. */
  channelMembers: VoiceMemberState[];
}

export interface VoiceXpEligibility {
  eligible: boolean;
  reason: VoiceXpReason;
  /** Bounded, non-sensitive counts for observability — never user IDs. */
  diagnostics: { activeHumans: number; otherHumans: number; bots: number };
}

/** True once the state is well-formed enough to reason about. */
function hasValidState(m: VoiceMemberState | null | undefined): m is VoiceMemberState {
  return (
    !!m &&
    typeof m.userId === "string" &&
    m.userId.length > 0 &&
    typeof m.isBot === "boolean" &&
    typeof m.selfMute === "boolean" &&
    typeof m.selfDeaf === "boolean" &&
    typeof m.serverMute === "boolean" &&
    typeof m.serverDeaf === "boolean"
  );
}

/**
 * Self-only ineligibility: the reasons a member fails on their own, regardless
 * of who else is in the channel. Returns null when the member is an "active"
 * conversation participant. Order fixes reason precedence (server before self).
 */
export function selfIneligibility(m: VoiceMemberState): Exclude<VoiceXpReason, "ELIGIBLE" | "ALONE" | "BOTS_ONLY"> | null {
  if (m.isBot) return "USER_IS_BOT";
  if (m.serverMute) return "SERVER_MUTED";
  if (m.serverDeaf) return "SERVER_DEAFENED";
  if (m.selfMute) return "SELF_MUTED";
  if (m.selfDeaf) return "SELF_DEAFENED";
  return null;
}

/** A real, participating human: valid state, not a bot, not muted/deafened. */
export function isActiveHuman(m: VoiceMemberState | null | undefined): m is VoiceMemberState {
  return hasValidState(m) && selfIneligibility(m) === null;
}

/**
 * Channel-level rule used by the per-minute tick: the set of members who earn XP
 * in a single (non-AFK) voice channel. Deduped by Discord user ID. Everyone in
 * the returned set is an active human AND has at least one other active human to
 * talk to; if fewer than two active humans are present, nobody earns (empty).
 */
export function eligibleVoiceXpEarners(channelMembers: readonly VoiceMemberState[]): string[] {
  const active = new Map<string, VoiceMemberState>(); // userId → state, deduped
  for (const m of channelMembers) {
    if (!isActiveHuman(m)) continue;
    if (!active.has(m.userId)) active.set(m.userId, m);
  }
  return active.size >= 2 ? [...active.keys()] : [];
}

function decision(eligible: boolean, reason: VoiceXpReason, d: Partial<VoiceXpEligibility["diagnostics"]> = {}): VoiceXpEligibility {
  return { eligible, reason, diagnostics: { activeHumans: 0, otherHumans: 0, bots: 0, ...d } };
}

/**
 * Full per-member decision with a bounded reason and diagnostics. The tick uses
 * {@link eligibleVoiceXpEarners} for efficiency, but this is the canonical,
 * exhaustively-tested rule (both agree by construction — they share the checks).
 */
export function isEligibleForVoiceXp(
  target: VoiceMemberState | null | undefined,
  ctx: VoiceXpContext | null | undefined,
): VoiceXpEligibility {
  if (!ctx) return decision(false, "MISSING_GUILD");
  if (!ctx.levelsConfigured) return decision(false, "LEVELS_MISCONFIGURED");
  if (!ctx.levelsEnabled) return decision(false, "LEVELS_DISABLED");
  if (target === null || target === undefined) return decision(false, "MISSING_MEMBER");
  if (!hasValidState(target)) return decision(false, "GATEWAY_STATE_INCOMPLETE");
  if (!ctx.channelId) return decision(false, "NOT_IN_VOICE");
  if (ctx.afkChannelId !== null && ctx.channelId === ctx.afkChannelId) return decision(false, "AFK_CHANNEL");

  const self = selfIneligibility(target);
  if (self) return decision(false, self);

  // Count the OTHER members sharing the channel, deduped by user ID. An active
  // human present anywhere in the channel makes the target eligible.
  const seen = new Set<string>([target.userId]);
  let otherHumans = 0;
  let activeOthers = 0;
  let bots = 0;
  for (const m of ctx.channelMembers) {
    if (!hasValidState(m)) continue; // ignore members in an invalid state
    if (seen.has(m.userId)) continue; // dedupe + skip the target itself
    seen.add(m.userId);
    if (m.isBot) {
      bots++;
      continue;
    }
    otherHumans++;
    if (selfIneligibility(m) === null) activeOthers++;
  }

  const diagnostics = { activeHumans: activeOthers + 1, otherHumans, bots };
  if (activeOthers >= 1) return decision(true, "ELIGIBLE", diagnostics);
  // No active human besides the target: alone in practice. Distinguish a channel
  // shared only with bots (no other humans at all) from one where the only other
  // humans are muted/deafened.
  if (otherHumans === 0 && bots > 0) return decision(false, "BOTS_ONLY", diagnostics);
  return decision(false, "ALONE", diagnostics);
}
