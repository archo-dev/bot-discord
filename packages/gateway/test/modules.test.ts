import { describe, expect, it } from "vitest";
import {
  MODULE_DEFINITIONS,
  MODULE_IDS,
  MODULE_REGISTRY,
  evaluateModuleState,
  findModuleDependencyCycles,
  missingModuleDependencies,
  moduleForCommand,
  type ModuleDefinition,
} from "@bot/shared";

const baseInput = {
  enabled: true,
  configVersion: 1,
  configurationComplete: true,
  dependencyEnabled: {},
  gatewayOnline: true,
  knownIntents: ["guild_voice_states", "guild_messages", "message_content", "guild_message_reactions", "guild_members", "guilds"] as const,
  missingPermissions: [] as const,
};

describe("M03 shared module registry", () => {
  it("has unique, exhaustive and stable identifiers", () => {
    expect(new Set(MODULE_IDS).size).toBe(MODULE_IDS.length);
    expect(new Set(MODULE_DEFINITIONS.map((module) => module.id)).size).toBe(MODULE_IDS.length);
    expect(Object.keys(MODULE_REGISTRY).sort()).toEqual([...MODULE_IDS].sort());
    expect(MODULE_DEFINITIONS.every((module) => module.configVersion >= module.minimumConfigVersion)).toBe(true);
  });

  it("contains no missing or circular dependency", () => {
    expect(missingModuleDependencies()).toEqual([]);
    expect(findModuleDependencyCycles()).toEqual([]);

    const cyclic = [
      { ...MODULE_REGISTRY.general, id: "general", dependencies: ["audit"] },
      { ...MODULE_REGISTRY.audit, id: "audit", dependencies: ["general"] },
    ] as ModuleDefinition[];
    expect(findModuleDependencyCycles(cyclic)).toEqual([["general", "audit", "general"]]);
  });

  it("maps every built-in command to its governing module", () => {
    expect(moduleForCommand("ban")).toBe("moderation");
    expect(moduleForCommand("play")).toBe("music");
    expect(moduleForCommand("rank")).toBe("levels");
    expect(moduleForCommand("kiss")).toBe("social");
    expect(moduleForCommand("not-built-in")).toBeNull();
  });

  it("returns stable states for runtime and configuration failures", () => {
    expect(evaluateModuleState(MODULE_REGISTRY.music, { ...baseInput, enabled: false }).state).toBe("disabled");
    expect(evaluateModuleState(MODULE_REGISTRY.music, { ...baseInput, gatewayOnline: false }).state).toBe("gateway_offline");
    expect(evaluateModuleState(MODULE_REGISTRY.music, { ...baseInput, knownIntents: [] }).state).toBe("missing_intent");
    expect(evaluateModuleState(MODULE_REGISTRY.music, { ...baseInput, missingPermissions: ["connect"] }).state).toBe("missing_permission");
    expect(evaluateModuleState(MODULE_REGISTRY.tickets, { ...baseInput, configurationComplete: false }).state).toBe("misconfigured");
    expect(evaluateModuleState(MODULE_REGISTRY.music, { ...baseInput, configVersion: 2 }).state).toBe("incompatible_config");
  });
});
