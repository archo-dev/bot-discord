import type { Env } from "../env.js";
import { discordJson } from "../discord/rest.js";

interface DiscordGuild { owner_id: string; }

/** Reads ownership live: D1 must not become a stale authorization source. */
export async function getDiscordGuildOwnerId(env: Env, guildId: string): Promise<string> {
  return (await discordJson<DiscordGuild>(env, "GET", `/guilds/${guildId}`)).owner_id;
}

export async function isDiscordGuildOwner(env: Env, guildId: string, userId: string): Promise<boolean> {
  return (await getDiscordGuildOwnerId(env, guildId)) === userId;
}
