import { describe, expect, it } from "vitest";
import { PLAN_TIERS, serversLabel } from "../src/lib/plans.js";

describe("plans presentational catalogue (M3)", () => {
  it("expose exactement les trois offres validées (free/premium/business, 1/3/5)", () => {
    expect(PLAN_TIERS.map((p) => p.id)).toEqual(["free", "premium", "business"]);
    expect(PLAN_TIERS.map((p) => p.servers)).toEqual([1, 3, 5]);
  });

  it("met Premium en avant (et lui seul)", () => {
    const highlighted = PLAN_TIERS.filter((p) => p.highlighted);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]?.id).toBe("premium");
  });

  it("ne contient AUCUN prix (décision D1 ouverte)", () => {
    for (const plan of PLAN_TIERS) {
      const keys = Object.keys(plan);
      expect(keys).not.toContain("price");
      expect(keys).not.toContain("amount");
      expect(JSON.stringify(plan)).not.toMatch(/€|\bEUR\b|\bUSD\b|\$\d/);
    }
  });

  it("porte les positionnements et niveaux de support validés", () => {
    expect(PLAN_TIERS.find((p) => p.id === "free")?.tagline).toBe("Pour commencer sereinement");
    expect(PLAN_TIERS.find((p) => p.id === "premium")?.tagline).toBe("Pour développer votre communauté");
    expect(PLAN_TIERS.find((p) => p.id === "business")?.tagline).toBe("Pour gérer sans compromis");
    expect(PLAN_TIERS.find((p) => p.id === "business")?.support).toMatch(/ultra-prioritaire/i);
  });

  it("serversLabel gère le singulier/pluriel", () => {
    expect(serversLabel(1)).toBe("1 serveur");
    expect(serversLabel(3)).toBe("3 serveurs");
  });
});
