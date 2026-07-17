export const MODULE_IDS = [
  "general",
  "custom_commands",
  "tickets",
  "button_roles",
  "welcome",
  "automod",
  "levels",
  "starboard",
  "temp_voice",
  "music",
  "moderation",
  "voice_logs",
  "stats",
  "panel_access",
  "health",
  "audit",
  "social",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];
export type ModuleCategory = "server" | "engagement" | "moderation" | "tools" | "operations";
export type ModuleAvailability = "public" | "system";
export type ModuleGatewayRequirement = "none" | "optional" | "required";

export const DISCORD_INTENT_IDS = [
  "guilds",
  "guild_members",
  "guild_messages",
  "message_content",
  "guild_voice_states",
  "guild_message_reactions",
  "guild_presences",
] as const;
export type DiscordIntentId = (typeof DISCORD_INTENT_IDS)[number];

export const DISCORD_PERMISSION_IDS = [
  "view_channel",
  "send_messages",
  "embed_links",
  "attach_files",
  "manage_messages",
  "manage_roles",
  "manage_channels",
  "move_members",
  "connect",
  "speak",
  "kick_members",
  "ban_members",
  "moderate_members",
  "change_nickname",
] as const;
export type DiscordPermissionId = (typeof DISCORD_PERMISSION_IDS)[number];

/**
 * Discord permission bit positions (see the developer docs "Permissions" table).
 * Used to build the minimal `permissions=` bitfield of the bot invite URL from the
 * modules a fresh server gets by default — never a hardcoded "Administrator" grant.
 */
export const DISCORD_PERMISSION_BITS: Readonly<Record<DiscordPermissionId, bigint>> = {
  view_channel: 1n << 10n,
  send_messages: 1n << 11n,
  embed_links: 1n << 14n,
  attach_files: 1n << 15n,
  manage_messages: 1n << 13n,
  manage_roles: 1n << 28n,
  manage_channels: 1n << 4n,
  move_members: 1n << 24n,
  connect: 1n << 20n,
  speak: 1n << 21n,
  kick_members: 1n << 1n,
  ban_members: 1n << 2n,
  moderate_members: 1n << 40n,
  change_nickname: 1n << 26n,
};

export type ModuleCapabilityKind = "read" | "configure" | "execute" | "toggle";
export type ModuleTechnicalCapability = `${ModuleId}.${ModuleCapabilityKind}`;
export type CapabilityGrantSource = "platform" | "guild_configuration" | "runtime";

export interface CapabilityEntitlement {
  capability: ModuleTechnicalCapability;
  granted: boolean;
  source: CapabilityGrantSource;
  reasonCode: ModuleStateReasonCode | null;
}

export interface ModuleQuotaDescriptor {
  id: "discord_publish" | "guild_identity" | "music_control";
  scope: "guild" | "user";
  period: "day";
}

export interface ModuleDefinition {
  id: ModuleId;
  publicName: string;
  description: string;
  category: ModuleCategory;
  configVersion: number;
  minimumConfigVersion: number;
  defaultEnabled: boolean;
  toggleable: boolean;
  availability: ModuleAvailability;
  dependencies: readonly ModuleId[];
  conflicts: readonly ModuleId[];
  requiredIntents: readonly DiscordIntentId[];
  optionalIntents: readonly DiscordIntentId[];
  requiredPermissions: readonly DiscordPermissionId[];
  gateway: ModuleGatewayRequirement;
  worker: boolean;
  apiRoutes: readonly string[];
  commands: readonly string[];
  storage: readonly string[];
  capabilities: Readonly<{
    read: ModuleTechnicalCapability;
    configure: ModuleTechnicalCapability | null;
    execute: ModuleTechnicalCapability | null;
    toggle: ModuleTechnicalCapability | null;
  }>;
  quotas: readonly ModuleQuotaDescriptor[];
  healthModule: string | null;
  panel: Readonly<{ configurePath: string | null; icon: string }>;
  disableConsequence: string;
}

function capabilities(id: ModuleId, options: { configure?: boolean; execute?: boolean; toggle?: boolean } = {}) {
  return {
    read: `${id}.read` as const,
    configure: options.configure === false ? null : (`${id}.configure` as const),
    execute: options.execute === false ? null : (`${id}.execute` as const),
    toggle: options.toggle === false ? null : (`${id}.toggle` as const),
  };
}

export const MODULE_DEFINITIONS: readonly ModuleDefinition[] = [
  {
    id: "general", publicName: "Configuration générale", description: "Identité du bot, journaux serveur et réglages communs.", category: "server",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: false, availability: "system", dependencies: [], conflicts: [],
    requiredIntents: ["guilds"], optionalIntents: ["guild_members", "guild_messages", "message_content"],
    requiredPermissions: ["view_channel", "send_messages", "embed_links"], gateway: "optional", worker: true,
    apiRoutes: ["/api/guilds/:guildId", "/api/guilds/:guildId/config", "/api/guilds/:guildId/nickname", "/api/guilds/:guildId/log-settings"],
    commands: ["ping"], storage: ["guilds", "log_settings"], capabilities: capabilities("general", { toggle: false }), quotas: [{ id: "guild_identity", scope: "user", period: "day" }],
    healthModule: "core", panel: { configurePath: "config", icon: "sliders" }, disableConsequence: "platform_required",
  },
  {
    id: "custom_commands", publicName: "Commandes personnalisées", description: "Commandes slash ou mots-clés créées pour le serveur.", category: "tools",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guilds"], optionalIntents: ["guild_messages", "message_content"], requiredPermissions: [], gateway: "optional", worker: true,
    apiRoutes: ["/api/guilds/:guildId/commands", "/internal/guilds/:guildId/commands"], commands: [],
    storage: ["custom_commands", "custom_command_revisions"], capabilities: capabilities("custom_commands"), quotas: [], healthModule: "commands",
    panel: { configurePath: "commands", icon: "command" }, disableConsequence: "commands_preserved_execution_stopped",
  },
  {
    id: "tickets", publicName: "Tickets", description: "Support privé avec panneaux, salons et transcripts.", category: "moderation",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: false, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guilds"], optionalIntents: [], requiredPermissions: ["view_channel", "send_messages", "embed_links", "attach_files", "manage_channels"],
    gateway: "none", worker: true, apiRoutes: ["/api/guilds/:guildId/tickets/*"], commands: [], storage: ["ticket_settings", "tickets"],
    capabilities: capabilities("tickets"), quotas: [{ id: "discord_publish", scope: "guild", period: "day" }], healthModule: "tickets",
    panel: { configurePath: "tickets", icon: "ticket" }, disableConsequence: "new_tickets_stopped_existing_preserved",
  },
  {
    id: "button_roles", publicName: "Rôles à boutons", description: "Messages permettant aux membres de choisir leurs rôles.", category: "engagement",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guilds"], optionalIntents: [], requiredPermissions: ["view_channel", "send_messages", "manage_roles"], gateway: "none", worker: true,
    apiRoutes: ["/api/guilds/:guildId/button-roles"], commands: [], storage: ["button_role_messages", "button_roles"], capabilities: capabilities("button_roles"),
    quotas: [{ id: "discord_publish", scope: "guild", period: "day" }], healthModule: "roles", panel: { configurePath: "roles", icon: "tag" },
    disableConsequence: "components_stopped_messages_preserved",
  },
  {
    id: "welcome", publicName: "Accueil et départ", description: "Messages d’accueil, de départ et rôles automatiques.", category: "engagement",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: false, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guild_members"], optionalIntents: ["guild_presences"], requiredPermissions: ["view_channel", "send_messages", "manage_roles"], gateway: "required", worker: true,
    apiRoutes: ["/api/guilds/:guildId/welcome", "/api/guilds/:guildId/auto-roles"], commands: [], storage: ["welcome_settings", "auto_roles"],
    capabilities: capabilities("welcome"), quotas: [], healthModule: "welcome", panel: { configurePath: "welcome", icon: "wave" }, disableConsequence: "welcome_leave_roles_stopped",
  },
  {
    id: "automod", publicName: "Auto-modération", description: "Filtres automatiques de spam, invitations, liens et mots.", category: "moderation",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: false, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guild_messages", "message_content"], optionalIntents: [], requiredPermissions: ["view_channel", "manage_messages", "moderate_members"], gateway: "required", worker: true,
    apiRoutes: ["/api/guilds/:guildId/automod", "/internal/guilds/:guildId/automod-sanctions"], commands: [], storage: ["automod_settings", "warnings", "mod_actions"],
    capabilities: capabilities("automod"), quotas: [], healthModule: "automod", panel: { configurePath: "automod", icon: "shield" }, disableConsequence: "message_filtering_stopped_config_preserved",
  },
  {
    id: "levels", publicName: "Niveaux et XP", description: "Progression par messages et vocal, récompenses et classement.", category: "engagement",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: false, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guild_messages", "message_content"], optionalIntents: ["guild_voice_states"], requiredPermissions: ["send_messages", "manage_roles"], gateway: "required", worker: true,
    apiRoutes: ["/api/guilds/:guildId/xp-settings", "/api/guilds/:guildId/leaderboard", "/internal/guilds/:guildId/xp"], commands: ["rank", "leaderboard"],
    storage: ["xp_settings", "xp_members"], capabilities: capabilities("levels"), quotas: [], healthModule: "levels", panel: { configurePath: "levels", icon: "trophy" }, disableConsequence: "xp_gain_and_commands_stopped_history_preserved",
  },
  {
    id: "starboard", publicName: "Starboard", description: "Sélection communautaire des messages les plus appréciés.", category: "engagement",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: false, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guild_message_reactions"], optionalIntents: [], requiredPermissions: ["view_channel", "send_messages", "embed_links"], gateway: "required", worker: true,
    apiRoutes: ["/api/guilds/:guildId/starboard-settings", "/internal/guilds/:guildId/starboard"], commands: [], storage: ["starboard_settings", "starboard_posts"],
    capabilities: capabilities("starboard"), quotas: [], healthModule: "starboard", panel: { configurePath: "starboard", icon: "star" }, disableConsequence: "reactions_ignored_posts_preserved",
  },
  {
    id: "temp_voice", publicName: "Vocaux temporaires", description: "Lobby rejoindre-pour-créer et contrôle des salons privés.", category: "engagement",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: false, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guild_voice_states"], optionalIntents: [], requiredPermissions: ["view_channel", "manage_channels", "move_members"], gateway: "required", worker: true,
    apiRoutes: ["/api/guilds/:guildId/temp-voice-settings", "/internal/guilds/:guildId/temp-voice/*"], commands: ["tempvoice", "voice"],
    storage: ["guild_tempvoice_settings", "temp_voice_channels"], capabilities: capabilities("temp_voice"), quotas: [], healthModule: "temp_voice",
    panel: { configurePath: "tempvoice", icon: "mic" }, disableConsequence: "new_channels_stopped_existing_preserved",
  },
  {
    id: "music", publicName: "Musique", description: "Lecture audio, file d’attente et playlists.", category: "tools",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guild_voice_states"], optionalIntents: [], requiredPermissions: ["view_channel", "send_messages", "connect", "speak"], gateway: "required", worker: true,
    apiRoutes: ["/api/guilds/:guildId/music-*", "/internal/guilds/:guildId/music-state"],
    commands: ["play", "pause", "resume", "skip", "stop", "queue", "remove", "shuffle", "loop", "volume", "seek", "nowplaying", "playlist"],
    storage: ["playlists", "KV music state"], capabilities: capabilities("music"), quotas: [{ id: "music_control", scope: "user", period: "day" }], healthModule: "music",
    panel: { configurePath: "music", icon: "music" }, disableConsequence: "new_controls_stopped_current_playback_not_destroyed",
  },
  {
    id: "moderation", publicName: "Modération", description: "Avertissements, sanctions et historique administratif.", category: "moderation",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: false, availability: "system", dependencies: [], conflicts: [], requiredIntents: ["guilds"], optionalIntents: [],
    requiredPermissions: ["kick_members", "ban_members", "manage_messages", "moderate_members"], gateway: "none", worker: true,
    apiRoutes: ["/api/guilds/:guildId/warnings", "/api/guilds/:guildId/mod-actions"], commands: ["ban", "unban", "kick", "mute", "warn", "warnings", "history", "clear"],
    storage: ["warnings", "mod_actions"], capabilities: capabilities("moderation", { toggle: false }), quotas: [], healthModule: "moderation", panel: { configurePath: "modlog", icon: "scroll" }, disableConsequence: "platform_required",
  },
  {
    id: "voice_logs", publicName: "Logs vocaux", description: "Historique des arrivées, départs et changements vocaux.", category: "moderation",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guild_voice_states"], optionalIntents: [], requiredPermissions: ["view_channel", "send_messages", "embed_links"], gateway: "required", worker: true,
    apiRoutes: ["/api/guilds/:guildId/voice-logs", "/internal/guilds/:guildId/voice-logs"], commands: [], storage: ["voice_logs", "log_settings"],
    capabilities: capabilities("voice_logs"), quotas: [], healthModule: "voice_logs", panel: { configurePath: "voicelog", icon: "mic" }, disableConsequence: "new_voice_history_stopped_existing_preserved",
  },
  {
    id: "stats", publicName: "Statistiques", description: "Évolution des membres et activité des salons.", category: "operations",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: true, availability: "public", dependencies: [], conflicts: [],
    requiredIntents: ["guild_messages", "guild_voice_states"], optionalIntents: ["guild_presences"], requiredPermissions: ["view_channel"], gateway: "required", worker: true,
    apiRoutes: ["/api/guilds/:guildId/stats/*", "/internal/guilds/:guildId/member-snapshots", "/internal/guilds/:guildId/channel-activity"], commands: [],
    storage: ["member_snapshots", "channel_activity"], capabilities: capabilities("stats"), quotas: [], healthModule: "stats", panel: { configurePath: "stats", icon: "chart" }, disableConsequence: "collection_stopped_history_preserved",
  },
  {
    id: "panel_access", publicName: "Accès panel", description: "Délégation administrateur et modérateur en lecture seule.", category: "server",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: false, availability: "system", dependencies: [], conflicts: [], requiredIntents: ["guilds", "guild_members"], optionalIntents: [],
    requiredPermissions: [], gateway: "none", worker: true, apiRoutes: ["/api/guilds/:guildId/panel-access"], commands: [], storage: ["panel_access"],
    capabilities: capabilities("panel_access", { execute: false, toggle: false }), quotas: [], healthModule: null, panel: { configurePath: "access", icon: "key" }, disableConsequence: "platform_required",
  },
  {
    id: "health", publicName: "Santé", description: "SLO et diagnostic technique par serveur.", category: "operations",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: false, availability: "system", dependencies: [], conflicts: [], requiredIntents: [], optionalIntents: [],
    requiredPermissions: [], gateway: "optional", worker: true, apiRoutes: ["/api/guilds/:guildId/health"], commands: [], storage: ["operation_metrics", "KV gateway status"],
    capabilities: capabilities("health", { configure: false, execute: false, toggle: false }), quotas: [], healthModule: "core", panel: { configurePath: "health", icon: "pulse" }, disableConsequence: "platform_required",
  },
  {
    id: "audit", publicName: "Audit", description: "Historique administratif minimal et borné.", category: "operations",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: false, availability: "system", dependencies: [], conflicts: [], requiredIntents: [], optionalIntents: [],
    requiredPermissions: [], gateway: "none", worker: true, apiRoutes: ["/api/guilds/:guildId/audit"], commands: [], storage: ["admin_audit_log"],
    capabilities: capabilities("audit", { configure: false, execute: false, toggle: false }), quotas: [], healthModule: "core", panel: { configurePath: "audit", icon: "shield" }, disableConsequence: "platform_required",
  },
  {
    id: "social", publicName: "Commandes sociales", description: "Interactions sociales légères entre membres.", category: "engagement",
    configVersion: 1, minimumConfigVersion: 1, defaultEnabled: true, toggleable: true, availability: "public", dependencies: [], conflicts: [], requiredIntents: ["guilds"], optionalIntents: [],
    requiredPermissions: ["send_messages", "embed_links"], gateway: "none", worker: true, apiRoutes: [], commands: ["kiss", "hug", "pat", "slap", "poke", "cuddle"], storage: [],
    capabilities: capabilities("social", { configure: false }), quotas: [], healthModule: "interactions", panel: { configurePath: null, icon: "users" }, disableConsequence: "social_commands_stopped",
  },
] as const;

export const MODULE_REGISTRY = Object.freeze(
  Object.fromEntries(MODULE_DEFINITIONS.map((definition) => [definition.id, definition])) as Record<ModuleId, ModuleDefinition>,
);

export const MODULE_STATE_VALUES = [
  "enabled",
  "disabled",
  "unavailable",
  "degraded",
  "misconfigured",
  "missing_dependency",
  "missing_permission",
  "missing_intent",
  "gateway_offline",
  "incompatible_config",
] as const;
export type ModuleState = (typeof MODULE_STATE_VALUES)[number];

export const MODULE_REASON_CODES = [
  "module_enabled",
  "module_disabled",
  "module_unavailable",
  "module_not_toggleable",
  "dependency_disabled",
  "gateway_offline",
  "intent_missing",
  "permission_missing",
  "configuration_missing",
  "config_version_incompatible",
  "runtime_check_unavailable",
  "health_degraded",
  "quota_reached",
] as const;
export type ModuleStateReasonCode = (typeof MODULE_REASON_CODES)[number];

export interface ModuleStateReason {
  code: ModuleStateReasonCode;
  dependency?: ModuleId;
  intent?: DiscordIntentId;
  permission?: DiscordPermissionId;
}

export interface ModuleEvaluationInput {
  enabled: boolean;
  configVersion: number;
  configurationComplete: boolean;
  dependencyEnabled: Readonly<Partial<Record<ModuleId, boolean>>>;
  gatewayOnline: boolean;
  knownIntents: readonly DiscordIntentId[] | null;
  missingPermissions: readonly DiscordPermissionId[] | null;
  healthDegraded?: boolean;
  quotaReached?: boolean;
}

export function evaluateModuleState(definition: ModuleDefinition, input: ModuleEvaluationInput): { state: ModuleState; reasons: ModuleStateReason[] } {
  if (definition.availability !== "public" && definition.toggleable) return { state: "unavailable", reasons: [{ code: "module_unavailable" }] };
  if (!input.enabled) return { state: "disabled", reasons: [{ code: "module_disabled" }] };
  if (input.configVersion < definition.minimumConfigVersion || input.configVersion > definition.configVersion) {
    return { state: "incompatible_config", reasons: [{ code: "config_version_incompatible" }] };
  }
  const missingDependency = definition.dependencies.find((dependency) => input.dependencyEnabled[dependency] !== true);
  if (missingDependency) return { state: "missing_dependency", reasons: [{ code: "dependency_disabled", dependency: missingDependency }] };
  if (definition.gateway === "required" && !input.gatewayOnline) return { state: "gateway_offline", reasons: [{ code: "gateway_offline" }] };
  if (input.knownIntents) {
    const missing = definition.requiredIntents.find((intent) => !input.knownIntents!.includes(intent));
    if (missing) return { state: "missing_intent", reasons: [{ code: "intent_missing", intent: missing }] };
  }
  if (input.missingPermissions?.length) {
    return { state: "missing_permission", reasons: input.missingPermissions.map((permission) => ({ code: "permission_missing", permission })) };
  }
  if (!input.configurationComplete) return { state: "misconfigured", reasons: [{ code: "configuration_missing" }] };
  if (input.quotaReached) return { state: "degraded", reasons: [{ code: "quota_reached" }] };
  if (input.healthDegraded) return { state: "degraded", reasons: [{ code: "health_degraded" }] };
  if ((definition.gateway === "required" || definition.requiredPermissions.length > 0) && (input.knownIntents === null || input.missingPermissions === null)) {
    return { state: "degraded", reasons: [{ code: "runtime_check_unavailable" }] };
  }
  return { state: "enabled", reasons: [{ code: "module_enabled" }] };
}

export function findModuleDependencyCycles(definitions: readonly ModuleDefinition[] = MODULE_DEFINITIONS): ModuleId[][] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const visited = new Set<ModuleId>();
  const visiting = new Set<ModuleId>();
  const stack: ModuleId[] = [];
  const cycles: ModuleId[][] = [];
  const walk = (id: ModuleId) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) walk(dependency);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const definition of definitions) walk(definition.id);
  return cycles;
}

export function missingModuleDependencies(definitions: readonly ModuleDefinition[] = MODULE_DEFINITIONS): ModuleId[] {
  const ids = new Set(definitions.map((definition) => definition.id));
  return definitions.flatMap((definition) => definition.dependencies.filter((dependency) => !ids.has(dependency)));
}

export function moduleForCommand(command: string): ModuleId | null {
  return MODULE_DEFINITIONS.find((definition) => definition.commands.includes(command))?.id ?? null;
}

/**
 * Minimal-yet-complete invite permission bitfield: the union of `requiredPermissions`
 * across the given modules. Defaults to *every* module so an admin invites once and
 * never has to re-invite when enabling another module later — each permission is still
 * explained one by one on the onboarding page (see `invitePermissionUsage`).
 */
export function invitePermissionBitfield(definitions: readonly ModuleDefinition[] = MODULE_DEFINITIONS): bigint {
  let bits = 0n;
  for (const definition of definitions) {
    for (const permission of definition.requiredPermissions) bits |= DISCORD_PERMISSION_BITS[permission];
  }
  return bits;
}

/** Maps each invited permission to the modules that need it, so the panel can justify the ask. */
export function invitePermissionUsage(
  definitions: readonly ModuleDefinition[] = MODULE_DEFINITIONS,
): { permission: DiscordPermissionId; modules: ModuleId[] }[] {
  return DISCORD_PERMISSION_IDS.map((permission) => ({
    permission,
    modules: definitions.filter((definition) => definition.requiredPermissions.includes(permission)).map((definition) => definition.id),
  })).filter((entry) => entry.modules.length > 0);
}
