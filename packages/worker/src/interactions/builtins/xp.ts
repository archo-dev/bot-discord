import { levelFromXp, totalXpForLevel, xpForNextLevel } from "@bot/shared";
import { getXpMember, listXpLeaderboard, xpRank } from "../../db/queries.js";
import { embedMessage, ephemeral } from "../respond.js";
import type { BuiltinHandler } from "./index.js";
import { displayName, userOption } from "./util.js";

function progressBar(current: number, total: number, width = 12): string {
  const filled = Math.min(width, Math.round((current / total) * width));
  return `${"▰".repeat(filled)}${"▱".repeat(width - filled)}`;
}

export const rankHandler: BuiltinHandler = async (ctx) => {
  const guildId = ctx.interaction.guild_id!;
  const target = userOption(ctx.interaction, "membre") ?? ctx.interaction.member!.user;
  if (target.bot) return ephemeral("⚠️ Les bots ne gagnent pas d'XP.");

  const member = await getXpMember(ctx.env.DB, guildId, target.id);
  if (!member || member.xp === 0) {
    return ephemeral(`**${displayName(target)}** n'a pas encore gagné d'XP sur ce serveur.`);
  }

  const level = levelFromXp(member.xp);
  const inLevel = member.xp - totalXpForLevel(level);
  const needed = xpForNextLevel(level);
  const rank = await xpRank(ctx.env.DB, guildId, member.xp);

  return embedMessage({
    title: `Niveau de ${displayName(target)}`,
    color: 0x5865f2,
    fields: [
      { name: "Niveau", value: `**${level}**`, inline: true },
      { name: "Classement", value: `#${rank}`, inline: true },
      { name: "Messages", value: String(member.messages), inline: true },
      {
        name: `Progression vers le niveau ${level + 1}`,
        value: `${progressBar(inLevel, needed)} ${inLevel}/${needed} XP (${member.xp} au total)`,
      },
    ],
  });
};

const MEDALS = ["🥇", "🥈", "🥉"];

export const leaderboardHandler: BuiltinHandler = async (ctx) => {
  const guildId = ctx.interaction.guild_id!;
  const rows = await listXpLeaderboard(ctx.env.DB, guildId, 10);
  if (rows.length === 0) return ephemeral("Personne n'a encore gagné d'XP sur ce serveur.");

  return embedMessage({
    title: "🏆 Classement XP",
    color: 0xfaa61a,
    description: rows
      .map((r, i) => {
        const medal = MEDALS[i] ?? `**#${i + 1}**`;
        const name = r.username ?? `<@${r.user_id}>`;
        return `${medal} ${name} — niveau **${levelFromXp(r.xp)}** · ${r.xp} XP · ${r.messages} messages`;
      })
      .join("\n"),
  });
};
