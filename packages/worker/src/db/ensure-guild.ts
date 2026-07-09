import type { Env } from "../env.js";
import { discordJson } from "../discord/rest.js";
import { getGuild, upsertGuild } from "./queries.js";

interface RESTGuild {
  id: string;
  name: string;
  icon: string | null;
}

/**
 * Guarantees a `guilds` row exists for this guild. Interaction payloads don't
 * carry the guild name, so on first sight we fetch it via REST (bot token).
 * Runs in waitUntil — never blocks the interaction response.
 */
export async function ensureGuild(env: Env, guildId: string): Promise<void> {
  try {
    const existing = await getGuild(env.DB, guildId);
    if (existing && existing.bot_installed === 1) return;
    const guild = await discordJson<RESTGuild>(env, "GET", `/guilds/${guildId}`);
    await upsertGuild(env.DB, guild.id, guild.name, guild.icon);
  } catch (err) {
    console.error(`ensureGuild(${guildId}) failed:`, err);
  }
}
