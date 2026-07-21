import { describe, expect, it } from "vitest";
import { supportPriorityForPlan } from "@bot/shared";
import { getPlatformFlags } from "../src/lib/flags.js";
import { supportAuthorLabel, supportPriorityLabel, supportStatusLabel } from "../src/lib/support.js";

/* Cible @bot/shared (priorité pure) + helpers panel support (M11). */

describe("support priority (M11)", () => {
  it("dérive la priorité du plan (backend truth)", () => {
    expect(supportPriorityForPlan("free")).toBe("low");
    expect(supportPriorityForPlan("premium")).toBe("normal");
    expect(supportPriorityForPlan("business")).toBe("high");
  });
});

describe("support display helpers (M11)", () => {
  it("libellés de priorité / statut / auteur", () => {
    expect(supportPriorityLabel("high")).toContain("maximale");
    expect(supportPriorityLabel("normal")).toContain("élevée");
    expect(supportPriorityLabel("low")).toContain("standard");
    expect(supportStatusLabel("open")).toBe("Ouvert");
    expect(supportStatusLabel("closed")).toBe("Fermé");
    expect(supportAuthorLabel("user")).toBe("Vous");
    expect(supportAuthorLabel("operator")).toBe("Support");
    expect(supportAuthorLabel("system")).toBe("Système");
  });
});

describe("panel platform.support flag (M11)", () => {
  it("off par défaut, on via VITE_PLATFORM_SUPPORT === 'true'", () => {
    expect(getPlatformFlags({})["platform.support"]).toBe(false);
    expect(getPlatformFlags({ VITE_PLATFORM_SUPPORT: "true" })["platform.support"]).toBe(true);
    expect(getPlatformFlags({ VITE_PLATFORM_SUPPORT: "1" })["platform.support"]).toBe(false);
    expect(getPlatformFlags({ VITE_PLATFORM_SUPPORT: "true" })["platform.billing"]).toBe(false);
  });
});
