import { describe, expect, it } from "vitest";
import { assessGatewayModuleRuntime } from "../src/module-runtime.js";

describe("M03 gateway module runtime", () => {
  it("reports actual intents and bounded missing permissions", () => {
    const result = assessGatewayModuleRuntime({
      guildId: "1",
      hasIntent: (intent) => intent === "guilds" || intent === "guild_voice_states",
      permissionsKnown: true,
      hasPermission: (permission) => permission !== "connect" && permission !== "speak",
    });
    expect(result.intents).toEqual(["guilds", "guild_voice_states"]);
    expect(result.missingPermissions.music).toEqual(["connect", "speak"]);
    expect(result.permissionsKnown).toBe(true);
  });

  it("does not claim missing permissions when the member cache is unavailable", () => {
    const result = assessGatewayModuleRuntime({ guildId: "1", hasIntent: () => true, permissionsKnown: false, hasPermission: () => false });
    expect(result.permissionsKnown).toBe(false);
    expect(result.missingPermissions).toEqual({});
  });
});
