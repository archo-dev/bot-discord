import { describe, expect, it } from "vitest";
import { buildSearchIndex, nextSearchIndex, searchGlobalIndex } from "../src/navigation/search-index.js";

const adminOnline = buildSearchIndex({ canWrite: true, gatewayConnected: true, flags: {} });
const moderatorOffline = buildSearchIndex({ canWrite: false, gatewayConnected: false, flags: {} });

describe("global navigation search", () => {
  it.each([
    ["rôle", "Rôles"],
    ["logs vocaux", "Journaux"],
    ["bienvenue", "Bienvenue"],
    ["ticket", "Tickets"],
    ["musique", "Musique"],
    ["audit", "Audit"],
    ["automod", "Auto-mod"],
    ["commande", "Commandes personnalisées"],
    ["sauvegarde", "Sauvegardes"],
    ["accès panel", "Accès panel"],
  ])("finds %s through labels, accents or synonyms", (query, expected) => {
    expect(searchGlobalIndex(adminOnline, query).map((entry) => entry.label)).toContain(expected);
  });

  it("groups results in the four requested kinds", () => {
    expect(new Set(adminOnline.map((entry) => entry.kind))).toEqual(
      new Set(["Pages", "Modules", "Paramètres", "Actions"]),
    );
  });

  it("never exposes write or Gateway-only actions to an offline moderator", () => {
    expect(moderatorOffline.some((entry) => entry.access === "write")).toBe(false);
    expect(moderatorOffline.some((entry) => entry.id === "setting.welcome.message")).toBe(false);
    expect(moderatorOffline.some((entry) => entry.id === "route.commands.commands/new")).toBe(false);
    expect(searchGlobalIndex(moderatorOffline, "musique").map((entry) => entry.label)).toContain("Musique");
  });

  it("returns a deterministic, bounded suggestion list for an empty query", () => {
    const results = searchGlobalIndex(adminOnline, "", 12);
    expect(results).toHaveLength(12);
    expect(results.every((entry) => entry.kind === "Pages" || entry.kind === "Modules")).toBe(true);
  });

  it("supports Arrow, Home and End keyboard navigation with wrapping", () => {
    expect(nextSearchIndex(0, "ArrowDown", 4)).toBe(1);
    expect(nextSearchIndex(3, "ArrowDown", 4)).toBe(0);
    expect(nextSearchIndex(0, "ArrowUp", 4)).toBe(3);
    expect(nextSearchIndex(2, "Home", 4)).toBe(0);
    expect(nextSearchIndex(1, "End", 4)).toBe(3);
  });
});
