import {
  DISCORD_INTENT_IDS,
  MODULE_DEFINITIONS,
  type DiscordIntentId,
  type DiscordPermissionId,
  type GatewayModuleRuntimeResponse,
} from "@bot/shared";
import { GatewayIntentBits, PermissionFlagsBits, type Client } from "discord.js";

const INTENT_BITS: Record<DiscordIntentId, number> = {
  guilds: GatewayIntentBits.Guilds,
  guild_members: GatewayIntentBits.GuildMembers,
  guild_messages: GatewayIntentBits.GuildMessages,
  message_content: GatewayIntentBits.MessageContent,
  guild_voice_states: GatewayIntentBits.GuildVoiceStates,
  guild_message_reactions: GatewayIntentBits.GuildMessageReactions,
  guild_presences: GatewayIntentBits.GuildPresences,
};

const PERMISSION_BITS: Record<DiscordPermissionId, bigint> = {
  view_channel: PermissionFlagsBits.ViewChannel,
  send_messages: PermissionFlagsBits.SendMessages,
  embed_links: PermissionFlagsBits.EmbedLinks,
  attach_files: PermissionFlagsBits.AttachFiles,
  manage_messages: PermissionFlagsBits.ManageMessages,
  manage_roles: PermissionFlagsBits.ManageRoles,
  manage_channels: PermissionFlagsBits.ManageChannels,
  move_members: PermissionFlagsBits.MoveMembers,
  connect: PermissionFlagsBits.Connect,
  speak: PermissionFlagsBits.Speak,
  kick_members: PermissionFlagsBits.KickMembers,
  ban_members: PermissionFlagsBits.BanMembers,
  moderate_members: PermissionFlagsBits.ModerateMembers,
  change_nickname: PermissionFlagsBits.ChangeNickname,
};

export function assessGatewayModuleRuntime(input: {
  guildId: string;
  hasIntent: (intent: DiscordIntentId) => boolean;
  permissionsKnown: boolean;
  hasPermission: (permission: DiscordPermissionId) => boolean;
}): GatewayModuleRuntimeResponse {
  const intents = DISCORD_INTENT_IDS.filter(input.hasIntent);
  const missingPermissions: GatewayModuleRuntimeResponse["missingPermissions"] = {};
  if (input.permissionsKnown) {
    for (const definition of MODULE_DEFINITIONS) {
      const missing = definition.requiredPermissions.filter((permission) => !input.hasPermission(permission));
      if (missing.length > 0) missingPermissions[definition.id] = [...missing];
    }
  }
  return { guildId: input.guildId, intents, permissionsKnown: input.permissionsKnown, missingPermissions };
}

export function gatewayModuleRuntime(client: Client, guildId: string): GatewayModuleRuntimeResponse | null {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;
  const me = guild.members.me;
  return assessGatewayModuleRuntime({
    guildId,
    hasIntent: (intent) => client.options.intents.has(INTENT_BITS[intent]),
    permissionsKnown: me !== null,
    hasPermission: (permission) => me?.permissions.has(PERMISSION_BITS[permission]) === true,
  });
}
