import type {
  CapabilityEntitlement,
  DiscordIntentId,
  DiscordPermissionId,
  ModuleCategory,
  ModuleGatewayRequirement,
  ModuleId,
  ModuleQuotaDescriptor,
  ModuleState,
  ModuleStateReason,
  ModuleTechnicalCapability,
} from "../modules.js";

export interface GuildModuleDto {
  id: ModuleId;
  publicName: string;
  description: string;
  category: ModuleCategory;
  enabled: boolean;
  state: ModuleState;
  reasons: ModuleStateReason[];
  configVersion: number;
  currentConfigVersion: number;
  toggleable: boolean;
  dependencies: ModuleId[];
  requiredIntents: DiscordIntentId[];
  requiredPermissions: DiscordPermissionId[];
  gateway: ModuleGatewayRequirement;
  healthModule: string | null;
  quotas: ModuleQuotaDescriptor[];
  entitlements: CapabilityEntitlement[];
  capabilities: {
    read: ModuleTechnicalCapability;
    configure: ModuleTechnicalCapability | null;
    execute: ModuleTechnicalCapability | null;
    toggle: ModuleTechnicalCapability | null;
  };
  panel: { configurePath: string | null; icon: string };
  actions: { canEnable: boolean; canDisable: boolean; canConfigure: boolean };
  disableConsequence: string;
}

export interface GuildModulesResponse {
  governanceVersion: 1;
  generatedAt: string;
  gateway: { online: boolean; runtimeChecksAvailable: boolean };
  modules: GuildModuleDto[];
}

export interface GuildModulePatch {
  enabled: boolean;
}

export interface GatewayModuleRuntimeResponse {
  guildId: string;
  intents: DiscordIntentId[];
  permissionsKnown: boolean;
  missingPermissions: Partial<Record<ModuleId, DiscordPermissionId[]>>;
}

export interface GatewayModuleConfigEntry {
  enabled: boolean;
  configVersion: number;
}

export type GatewayModuleConfig = Partial<Record<ModuleId, GatewayModuleConfigEntry>>;
