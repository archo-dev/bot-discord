/**
 * Member-card helpers (M20). Shared by the Worker (REST sends) and the gateway
 * (discord.js sends) so both build byte-identical cards. Pure and
 * framework-agnostic: no discord.js / discord-api-types dependency.
 */

/** Discord epoch (2015-01-01T00:00:00Z), for snowflake → timestamp derivation. */
const DISCORD_EPOCH = 1420070400000;

/** Max member cards appended to a single message (decision acted in M20). */
export const MAX_MENTION_CARDS = 3;

export type MemberPresence = "online" | "idle" | "dnd" | "offline";

export interface MemberCardInfo {
  id: string;
  /** Display tag: global name / username (already resolved). */
  tag: string;
  /** Full avatar CDN URL, or null → no thumbnail/icon. */
  avatarUrl: string | null;
  /** ISO timestamp the member joined the guild, or null if unknown. */
  joinedAt: string | null;
  /** Role names to surface (already resolved + ordered, @everyone excluded). */
  roles: string[];
  /** Presence, when the Presence intent is active (M19); null/undefined → omitted. */
  presence?: MemberPresence | null;
}

/**
 * Minimal embed shape — structurally compatible with discord-api-types' APIEmbed
 * and discord.js's accepted embed objects, without depending on either package.
 */
export interface MemberCardEmbed {
  color?: number;
  author: { name: string; icon_url?: string };
  thumbnail?: { url: string };
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  footer: { text: string };
}

/** Account-creation timestamp (ms) derived from a snowflake id. */
export function snowflakeToTimestamp(id: string): number {
  return Number(BigInt(id) >> 22n) + DISCORD_EPOCH;
}

const MENTION_RE = /<@!?(\d+)>/g;

/**
 * User ids mentioned in `content`, de-duplicated and in first-appearance order.
 * Role (`<@&…>`), `@everyone` and `@here` mentions never match this pattern.
 */
export function extractUserMentions(content: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of content.matchAll(MENTION_RE)) {
    const id = m[1]!;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

const PRESENCE_LABELS: Record<MemberPresence, string> = {
  online: "🟢 En ligne",
  idle: "🌙 Inactif",
  dnd: "⛔ Ne pas déranger",
  offline: "⚫ Hors ligne",
};

const MAX_ROLES = 5;
const CARD_COLOR = 0x5865f2;

/**
 * Pure builder: one compact member card. `<t:…:R>` tokens are rendered
 * relative-time by Discord at display, so no formatting happens here.
 */
export function buildMemberCardEmbed(info: MemberCardInfo): MemberCardEmbed {
  const createdSec = Math.floor(snowflakeToTimestamp(info.id) / 1000);
  const fields: MemberCardEmbed["fields"] = [
    { name: "Compte créé", value: `<t:${createdSec}:R>`, inline: true },
  ];
  if (info.joinedAt) {
    const joinedSec = Math.floor(new Date(info.joinedAt).getTime() / 1000);
    if (Number.isFinite(joinedSec)) {
      fields.push({ name: "A rejoint", value: `<t:${joinedSec}:R>`, inline: true });
    }
  }
  if (info.presence) {
    fields.push({ name: "Statut", value: PRESENCE_LABELS[info.presence], inline: true });
  }
  if (info.roles.length > 0) {
    const shown = info.roles.slice(0, MAX_ROLES);
    const extra = info.roles.length - shown.length;
    fields.push({
      name: `Rôles (${info.roles.length})`,
      value: shown.join(", ") + (extra > 0 ? `, +${extra}` : ""),
      inline: false,
    });
  }
  return {
    color: CARD_COLOR,
    author: { name: info.tag, ...(info.avatarUrl ? { icon_url: info.avatarUrl } : {}) },
    ...(info.avatarUrl ? { thumbnail: { url: info.avatarUrl } } : {}),
    fields,
    footer: { text: `ID: ${info.id}` },
  };
}
