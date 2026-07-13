export type PanelGuildAccess = "manage_guild" | "panel_admin" | "panel_moderator";

export const PANEL_CAPABILITIES = [
  "guild_config_write",
  "guild_identity_write",
  "panel_access_manage",
  "roles_write",
  "roles_publish",
  "moderation_write",
  "commands_write",
  "music_control",
  "tickets_write",
] as const;

export type PanelCapability = (typeof PANEL_CAPABILITIES)[number];

export interface PanelMutationPolicy {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  capability: PanelCapability;
  allowed: readonly PanelGuildAccess[];
}

const ADMIN = ["manage_guild", "panel_admin"] as const;
const OWNER = ["manage_guild"] as const;

/**
 * Versioned inventory of every cookie-authenticated guild mutation. Unknown
 * mutations are denied by the Worker until they are explicitly classified.
 */
export const PANEL_MUTATION_POLICIES: readonly PanelMutationPolicy[] = [
  { method: "PATCH", path: "/api/guilds/:guildId/config", capability: "guild_config_write", allowed: ADMIN },
  { method: "PATCH", path: "/api/guilds/:guildId/nickname", capability: "guild_identity_write", allowed: ADMIN },
  { method: "PUT", path: "/api/guilds/:guildId/panel-access", capability: "panel_access_manage", allowed: OWNER },
  { method: "PUT", path: "/api/guilds/:guildId/auto-roles", capability: "roles_write", allowed: ADMIN },
  { method: "DELETE", path: "/api/guilds/:guildId/warnings/:warnId", capability: "moderation_write", allowed: ADMIN },
  { method: "POST", path: "/api/guilds/:guildId/button-roles", capability: "roles_publish", allowed: ADMIN },
  { method: "DELETE", path: "/api/guilds/:guildId/button-roles/:id", capability: "roles_write", allowed: ADMIN },
  { method: "PUT", path: "/api/guilds/:guildId/temp-voice-settings", capability: "guild_config_write", allowed: ADMIN },
  { method: "PUT", path: "/api/guilds/:guildId/automod", capability: "guild_config_write", allowed: ADMIN },
  { method: "POST", path: "/api/guilds/:guildId/commands", capability: "commands_write", allowed: ADMIN },
  { method: "PUT", path: "/api/guilds/:guildId/commands/:id", capability: "commands_write", allowed: ADMIN },
  { method: "PATCH", path: "/api/guilds/:guildId/commands/:id/state", capability: "commands_write", allowed: ADMIN },
  { method: "DELETE", path: "/api/guilds/:guildId/commands/:id", capability: "commands_write", allowed: ADMIN },
  { method: "POST", path: "/api/guilds/:guildId/music-control", capability: "music_control", allowed: ADMIN },
  { method: "PUT", path: "/api/guilds/:guildId/starboard-settings", capability: "guild_config_write", allowed: ADMIN },
  { method: "PUT", path: "/api/guilds/:guildId/tickets/settings", capability: "tickets_write", allowed: ADMIN },
  { method: "POST", path: "/api/guilds/:guildId/tickets/panel", capability: "tickets_write", allowed: ADMIN },
  { method: "PUT", path: "/api/guilds/:guildId/xp-settings", capability: "guild_config_write", allowed: ADMIN },
  { method: "PUT", path: "/api/guilds/:guildId/welcome", capability: "guild_config_write", allowed: ADMIN },
  { method: "PUT", path: "/api/guilds/:guildId/log-settings", capability: "guild_config_write", allowed: ADMIN },
  { method: "PATCH", path: "/api/guilds/:guildId/modules/:moduleId", capability: "guild_config_write", allowed: ADMIN },
] as const;

function matchesPath(pattern: string, pathname: string): boolean {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  return expected.length === actual.length && expected.every((part, index) => part.startsWith(":") || part === actual[index]);
}

export function matchPanelMutationPolicy(method: string, pathname: string): PanelMutationPolicy | null {
  const normalizedMethod = method.toUpperCase();
  return PANEL_MUTATION_POLICIES.find(
    (policy) => policy.method === normalizedMethod && matchesPath(policy.path, pathname),
  ) ?? null;
}

export function isPanelMutationAllowed(policy: PanelMutationPolicy, access: PanelGuildAccess): boolean {
  return policy.allowed.includes(access);
}
