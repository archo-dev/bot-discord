import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@bot/shared";
import {
  NAVIGATION_GROUPS,
  NAVIGATION_REGISTRY,
  SIDEBAR_DESTINATIONS,
  destinationPath,
  destinationMatches,
  navigationGroups,
  resolveNavigation,
} from "../src/navigation/registry.js";

const routes = [
  "",
  "onboarding",
  "modules",
  "stats",
  "health",
  "audit",
  "config",
  "backup",
  "privacy",
  "access",
  "welcome",
  "roles",
  "levels",
  "starboard",
  "tempvoice",
  "automod",
  "sanctions",
  "apply",
  "modlog",
  "voicelog",
  "tickets",
  "commands",
  "automations",
  "music",
] as const;

describe("compact guild navigation", () => {
  it("keeps every existing page reachable exactly once", () => {
    for (const route of routes) {
      expect(NAVIGATION_REGISTRY.filter((item) => destinationMatches(item, route)), route).toHaveLength(1);
    }
  });

  it("uses the six validated groups and removes the former terminology", () => {
    expect(NAVIGATION_GROUPS.map((group) => group.label)).toEqual([
      "Accueil",
      "Communauté",
      "Modération",
      "Automatisation",
      "Audio",
      "Pilotage",
    ]);
    expect(JSON.stringify(NAVIGATION_REGISTRY)).not.toContain("Engagement");
  });

  it("preserves editor and legacy subroutes under their unique parent", () => {
    expect(resolveNavigation("commands/new").destination.id).toBe("commands");
    expect(resolveNavigation("commands/42").destination.id).toBe("commands");
    expect(resolveNavigation("automations/42").destination.id).toBe("automations");
    expect(resolveNavigation("modlog").destination.id).toBe("moderation");
  });

  it("keeps secondary pages searchable without overloading the sidebar", () => {
    expect(SIDEBAR_DESTINATIONS.some((item) => item.primaryPath === "onboarding")).toBe(false);
    expect(SIDEBAR_DESTINATIONS.some((item) => item.primaryPath === "modules")).toBe(false);
    expect(resolveNavigation("onboarding").destination.label).toBe("Prise en main");
    expect(resolveNavigation("modules").destination.label).toBe("Centre des modules");
    for (const path of ["access", "privacy", "backup"]) {
      expect(resolveNavigation(path).destination.id).toBe("settings");
    }
  });

  it("keeps moderator navigation readable while access remains read-only", () => {
    const groups = navigationGroups({ canWrite: false, gatewayConnected: false, flags: {} });
    expect(groups.flatMap((group) => group.destinations)).toHaveLength(SIDEBAR_DESTINATIONS.length);
    expect(groups.flatMap((group) => group.destinations).every((item) => item.access === "read")).toBe(true);
  });

  it("declares the same Gateway dependency as the module registry", () => {
    for (const destination of NAVIGATION_REGISTRY) {
      if (!destination.moduleId) continue;
      expect(destination.gateway, destination.id).toBe(MODULE_REGISTRY[destination.moduleId].gateway);
    }
  });

  it("keeps destination identifiers and primary routes unique", () => {
    expect(new Set(NAVIGATION_REGISTRY.map((item) => item.id)).size).toBe(NAVIGATION_REGISTRY.length);
    expect(new Set(NAVIGATION_REGISTRY.map((item) => item.primaryPath)).size).toBe(NAVIGATION_REGISTRY.length);
    for (const destination of NAVIGATION_REGISTRY) {
      expect(destinationPath(destination.id)).toBe(destination.primaryPath);
      expect(destination.label.trim()).not.toBe("");
      expect(destination.description.trim()).not.toBe("");
      expect(destination.keywords.length).toBeGreaterThan(0);
    }
  });
});
