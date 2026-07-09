import type { Env } from "../env.js";
import { discordJson } from "./rest.js";

/**
 * Per-guild registration of custom slash commands, driven by the panel.
 * Keyword-trigger commands are never registered (they need the gateway).
 */

interface RESTCommand {
  id: string;
}

const base = (env: Env, guildId: string): string => `/applications/${env.DISCORD_CLIENT_ID}/guilds/${guildId}/commands`;

export async function registerGuildCommand(env: Env, guildId: string, name: string, description: string): Promise<string> {
  const created = await discordJson<RESTCommand>(env, "POST", base(env, guildId), {
    name,
    description,
    dm_permission: false,
  });
  return created.id;
}

export async function updateGuildCommand(
  env: Env,
  guildId: string,
  commandId: string,
  name: string,
  description: string,
): Promise<void> {
  await discordJson(env, "PATCH", `${base(env, guildId)}/${commandId}`, { name, description });
}

export async function deleteGuildCommand(env: Env, guildId: string, commandId: string): Promise<void> {
  await discordJson(env, "DELETE", `${base(env, guildId)}/${commandId}`);
}
