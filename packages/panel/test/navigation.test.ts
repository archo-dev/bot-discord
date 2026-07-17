import { describe, expect, it } from "vitest";
import { NAV_GROUPS, NAV_ITEMS, matchesItem } from "../src/pages/GuildLayout.js";

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
      expect(NAV_ITEMS.filter((item) => matchesItem(item, route)), route).toHaveLength(1);
    }
  });

  it("reduces visible destinations and keeps groups short", () => {
    expect(NAV_ITEMS).toHaveLength(17);
    expect(Math.max(...NAV_GROUPS.map((group) => group.items.length))).toBeLessThanOrEqual(6);
  });

  it("preserves editor subroutes under their parent destination", () => {
    expect(NAV_ITEMS.find((item) => matchesItem(item, "commands/new"))?.to).toBe("commands");
    expect(NAV_ITEMS.find((item) => matchesItem(item, "automations/42"))?.to).toBe("automations");
  });
});
