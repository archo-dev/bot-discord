import { describe, expect, it } from "vitest";
import {
  CHANGE_TYPE_LABELS,
  CHANGE_TYPE_TONE,
  formatUpdateDate,
  moduleFilterOptions,
} from "../src/pages/public/updates-format.js";
import { RELEASE_NOTE_CHANGE_TYPES } from "@bot/shared";

describe("release notes formatting (M5)", () => {
  it("a un libellé FR et une teinte pour chaque catégorie", () => {
    for (const t of RELEASE_NOTE_CHANGE_TYPES) {
      expect(CHANGE_TYPE_LABELS[t]).toBeTruthy();
      expect(CHANGE_TYPE_TONE[t]).toContain("text-");
    }
  });

  it("formate une date ISO en français long", () => {
    expect(formatUpdateDate("2026-07-20T00:00:00.000Z")).toMatch(/2026/);
    expect(formatUpdateDate("2026-07-20T00:00:00.000Z")).toContain("juillet");
  });

  it("renvoie une chaîne vide pour une date invalide (jamais de crash)", () => {
    expect(formatUpdateDate("pas-une-date")).toBe("");
    expect(formatUpdateDate("")).toBe("");
  });

  it("construit les options de filtre avec « Tous » en tête, sans doublon", () => {
    const opts = moduleFilterOptions(["music", "automod", "music", ""]);
    expect(opts[0]).toEqual({ value: null, label: "Tous" });
    expect(opts.map((o) => o.value)).toEqual([null, "music", "automod"]);
  });

  it("renvoie seulement « Tous » quand aucun module", () => {
    expect(moduleFilterOptions([])).toEqual([{ value: null, label: "Tous" }]);
  });
});
