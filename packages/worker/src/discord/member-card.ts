import type { APIEmbed } from "discord-api-types/v10";
import { buildMemberCardEmbed, extractUserMentions, MAX_MENTION_CARDS, type MemberCardInfo } from "@bot/shared";
import type { Env } from "../env.js";
import { getMember } from "../auth/guard.js";
import { getGuild } from "../db/queries.js";
import { discordJson } from "../discord/rest.js";

/** Discord caps a message at 10 embeds — never exceed it when appending cards. */
const MAX_EMBEDS = 10;

export interface CardablePayload {
  content?: string;
  embeds?: APIEmbed[];
  [k: string]: unknown;
}

function avatarUrl(user: { id: string; avatar: string | null }): string {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  const idx = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

/** Guild role id → name, from the same KV cache the panel roles endpoint fills (300s). */
async function getRoleNames(env: Env, guildId: string): Promise<Map<string, string>> {
  const cached = await env.KV.get(`roles:${guildId}`);
  let roles: Array<{ id: string; name: string }> = [];
  if (cached) {
    roles = JSON.parse(cached) as Array<{ id: string; name: string }>;
  } else {
    try {
      roles = await discordJson<Array<{ id: string; name: string }>>(env, "GET", `/guilds/${guildId}/roles`);
    } catch {
      roles = [];
    }
  }
  return new Map(roles.map((r) => [r.id, r.name]));
}

/**
 * Central send helper (M20): when the guild opted in (`mention_cards`), appends
 * a compact member card for each unique user mentioned in `payload.content`
 * (1 per mention, capped at {@link MAX_MENTION_CARDS}, never over 10 embeds).
 * Returns the payload unchanged when the feature is off or there's nothing to add.
 * Members are looked up via the KV-cached bot REST helper (60s), roles resolved
 * to names via the roles KV cache — no extra Discord calls on a warm cache.
 */
export async function withMemberCards(env: Env, guildId: string, payload: CardablePayload): Promise<CardablePayload> {
  if (!payload.content) return payload;
  const guild = await getGuild(env.DB, guildId);
  if (!guild || guild.mention_cards !== 1) return payload;

  const existing = payload.embeds ?? [];
  const budget = Math.min(MAX_MENTION_CARDS, MAX_EMBEDS - existing.length);
  if (budget <= 0) return payload;

  const ids = extractUserMentions(payload.content).slice(0, budget);
  if (ids.length === 0) return payload;

  let roleNames: Map<string, string> | null = null;
  const cards: APIEmbed[] = [];
  for (const id of ids) {
    const member = await getMember(env, guildId, id);
    if (!member?.user) continue;
    if (!roleNames) roleNames = await getRoleNames(env, guildId);
    const info: MemberCardInfo = {
      id,
      tag: member.user.globalName ?? member.user.username,
      avatarUrl: avatarUrl({ id, avatar: member.user.avatar }),
      joinedAt: member.joinedAt,
      roles: member.roles
        .filter((r) => r !== guildId) // drop @everyone
        .map((r) => roleNames!.get(r))
        .filter((n): n is string => Boolean(n)),
    };
    cards.push(buildMemberCardEmbed(info) as APIEmbed);
  }
  if (cards.length === 0) return payload;
  return { ...payload, embeds: [...existing, ...cards] };
}
