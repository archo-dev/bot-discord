import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@bot/shared";
import { BENEFITS, USE_CASES, FEATURED_MODULES } from "../src/components/public/landing/data.js";

describe("landing content data (M3)", () => {
  it("fournit des bénéfices et cas d'usage non vides, à clés stables", () => {
    expect(BENEFITS.length).toBeGreaterThanOrEqual(4);
    expect(USE_CASES.length).toBeGreaterThanOrEqual(3);
    for (const b of BENEFITS) {
      expect(b.title.trim().length).toBeGreaterThan(0);
      expect(b.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("ne référence que des modules réels du registre", () => {
    for (const id of FEATURED_MODULES) {
      expect(MODULE_REGISTRY[id]).toBeDefined();
      expect(MODULE_REGISTRY[id].publicName.length).toBeGreaterThan(0);
    }
  });

  it("n'invente aucun chiffre d'utilisateurs/serveurs ni témoignage", () => {
    const blob = JSON.stringify([...BENEFITS, ...USE_CASES]);
    expect(blob).not.toMatch(/\b\d[\d\s.,]*\s*(utilisateurs|membres|serveurs|clients|avis)\b/i);
  });
});
