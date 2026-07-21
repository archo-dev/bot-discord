import { describe, expect, it } from "vitest";
import { mapProviderStatusToEntitlementStatus } from "@bot/shared";
import { getPlatformFlags } from "../src/lib/flags.js";

/* Cible @bot/shared : mapping billing pur (M9) + source du flag panel. */

describe("billing status mapping (M9)", () => {
  it("mappe chaque statut prestataire vers un statut d'entitlement", () => {
    expect(mapProviderStatusToEntitlementStatus("active")).toBe("active");
    expect(mapProviderStatusToEntitlementStatus("past_due")).toBe("past_due");
    expect(mapProviderStatusToEntitlementStatus("cancelled")).toBe("cancelled");
    expect(mapProviderStatusToEntitlementStatus("expired")).toBe("expired");
  });
});

describe("panel platform.billing flag (M9)", () => {
  it("off par défaut, on via VITE_PLATFORM_BILLING === 'true'", () => {
    expect(getPlatformFlags({})["platform.billing"]).toBe(false);
    expect(getPlatformFlags({ VITE_PLATFORM_BILLING: "true" })["platform.billing"]).toBe(true);
    expect(getPlatformFlags({ VITE_PLATFORM_BILLING: "1" })["platform.billing"]).toBe(false);
    // Indépendance des flags.
    expect(getPlatformFlags({ VITE_PLATFORM_BILLING: "true" })["platform.entitlements"]).toBe(false);
  });
});
