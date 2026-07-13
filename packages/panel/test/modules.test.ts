import { describe, expect, it } from "vitest";
import { MODULE_STATE_META, moduleReasonLabel } from "../src/lib/modules.js";

describe("module center presentation", () => {
  it("defines a visible label for every governance state", () => {
    expect(Object.keys(MODULE_STATE_META)).toHaveLength(10);
    expect(MODULE_STATE_META.gateway_offline.tone).toBe("warning");
  });

  it("renders stable diagnostic details without private Discord data", () => {
    expect(moduleReasonLabel({ code: "dependency_disabled", dependency: "general" })).toContain("general");
    expect(moduleReasonLabel({ code: "permission_missing", permission: "manage_roles" })).toContain("manage_roles");
  });
});
