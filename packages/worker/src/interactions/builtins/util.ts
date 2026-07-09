import type {
  APIApplicationCommandInteractionDataBasicOption,
  APIChatInputApplicationCommandInteraction,
  APIEmbed,
  APIUser,
} from "discord-api-types/v10";
import type { Env } from "../../env.js";
import { discordJson } from "../../discord/rest.js";
import { getGuild } from "../../db/queries.js";

// --- Option extraction ------------------------------------------------------

function findOption(
  interaction: APIChatInputApplicationCommandInteraction,
  name: string,
): APIApplicationCommandInteractionDataBasicOption | undefined {
  return interaction.data.options?.find(
    (o): o is APIApplicationCommandInteractionDataBasicOption => o.name === name && "value" in o,
  );
}

export function stringOption(interaction: APIChatInputApplicationCommandInteraction, name: string): string | undefined {
  const opt = findOption(interaction, name);
  return typeof opt?.value === "string" ? opt.value : undefined;
}

export function integerOption(interaction: APIChatInputApplicationCommandInteraction, name: string): number | undefined {
  const opt = findOption(interaction, name);
  return typeof opt?.value === "number" ? opt.value : undefined;
}

/** USER options resolve through data.resolved.users. */
export function userOption(interaction: APIChatInputApplicationCommandInteraction, name: string): APIUser | undefined {
  const opt = findOption(interaction, name);
  if (typeof opt?.value !== "string") return undefined;
  return interaction.data.resolved?.users?.[opt.value];
}

export function displayName(user: APIUser): string {
  return user.global_name ?? user.username;
}

// --- Mod-log ----------------------------------------------------------------

export const MOD_COLORS = {
  ban: 0xed4245,
  unban: 0x57f287,
  kick: 0xe67e22,
  timeout: 0xfaa61a,
  auto_timeout: 0xfaa61a,
  warn: 0xfee75c,
  unwarn: 0x57f287,
  clear: 0x5865f2,
} as const;

export function modLogEmbed(entry: {
  action: keyof typeof MOD_COLORS;
  title: string;
  targetId?: string;
  moderatorId: string;
  reason: string | null;
  caseId: number;
  extra?: Array<{ name: string; value: string }>;
}): APIEmbed {
  return {
    title: entry.title,
    color: MOD_COLORS[entry.action],
    fields: [
      ...(entry.targetId ? [{ name: "Membre", value: `<@${entry.targetId}> (${entry.targetId})`, inline: true }] : []),
      { name: "Modérateur", value: `<@${entry.moderatorId}>`, inline: true },
      ...(entry.reason ? [{ name: "Raison", value: entry.reason }] : []),
      ...(entry.extra ?? []),
    ],
    footer: { text: `Cas #${entry.caseId}` },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Posts to the configured mod-log channel. Failures are swallowed — logging
 * must never make the moderation action itself fail.
 */
export async function postModLog(env: Env, guildId: string, embed: APIEmbed): Promise<void> {
  try {
    const guild = await getGuild(env.DB, guildId);
    if (!guild?.log_channel_id) return;
    await discordJson(env, "POST", `/channels/${guild.log_channel_id}/messages`, {
      embeds: [embed],
      allowed_mentions: { parse: [] },
    });
  } catch (err) {
    console.error(`postModLog(${guildId}) failed:`, err);
  }
}
