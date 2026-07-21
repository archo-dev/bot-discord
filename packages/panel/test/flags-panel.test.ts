import { describe, expect, it } from "vitest";
import { getPlatformFlags } from "../src/lib/flags.js";

describe("panel platform flag source (M2)", () => {
  it("off par défaut (env vide)", () => {
    expect(getPlatformFlags({})["platform.publicSite"]).toBe(false);
  });

  it("on quand VITE_PLATFORM_PUBLIC_SITE === 'true'", () => {
    expect(getPlatformFlags({ VITE_PLATFORM_PUBLIC_SITE: "true" })["platform.publicSite"]).toBe(true);
  });

  it("off pour toute autre valeur (jamais activé par accident)", () => {
    expect(getPlatformFlags({ VITE_PLATFORM_PUBLIC_SITE: "1" })["platform.publicSite"]).toBe(false);
    expect(getPlatformFlags({ VITE_PLATFORM_PUBLIC_SITE: "TRUE" })["platform.publicSite"]).toBe(false);
    expect(getPlatformFlags({ VITE_PLATFORM_PUBLIC_SITE: true })["platform.publicSite"]).toBe(false);
    expect(getPlatformFlags({})["platform.publicSite"]).toBe(false);
  });

  it("platform.entitlements suit VITE_PLATFORM_ENTITLEMENTS (off par défaut) (M8)", () => {
    expect(getPlatformFlags({})["platform.entitlements"]).toBe(false);
    expect(getPlatformFlags({ VITE_PLATFORM_ENTITLEMENTS: "true" })["platform.entitlements"]).toBe(true);
    expect(getPlatformFlags({ VITE_PLATFORM_ENTITLEMENTS: "1" })["platform.entitlements"]).toBe(false);
    expect(getPlatformFlags({ VITE_PLATFORM_ENTITLEMENTS: true })["platform.entitlements"]).toBe(false);
    // Indépendance des deux flags.
    expect(getPlatformFlags({ VITE_PLATFORM_PUBLIC_SITE: "true" })["platform.entitlements"]).toBe(false);
  });
});
