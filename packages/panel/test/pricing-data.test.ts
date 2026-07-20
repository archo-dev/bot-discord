import { describe, expect, it } from "vitest";
import { PLAN_COMPARISON, FAQ_ITEMS, BILLING_PERIODS, billingPeriodNote } from "../src/components/public/pricing/data.js";

describe("pricing comparison data (M4)", () => {
  it("chaque ligne couvre les trois offres", () => {
    for (const row of PLAN_COMPARISON) {
      expect(Object.keys(row.values).sort()).toEqual(["business", "free", "premium"]);
      for (const v of Object.values(row.values)) expect(v.trim().length).toBeGreaterThan(0);
    }
  });

  it("porte la ligne Serveurs 1 / 3 / 5", () => {
    const servers = PLAN_COMPARISON.find((r) => r.label.startsWith("Serveurs"));
    expect(servers?.values).toEqual({ free: "1", premium: "3", business: "5" });
  });

  it("ne contient AUCUN prix (D1 ouverte)", () => {
    const blob = JSON.stringify([...PLAN_COMPARISON, ...FAQ_ITEMS]);
    expect(blob).not.toMatch(/€|\bEUR\b|\bUSD\b|\$\d|\d+\s*(€|euros?)\b/i);
    expect(blob).not.toMatch(/\d+\s*(%|pour cent)/i);
  });

  it("FAQ non vide, sans fausse promesse (pas de chiffres d'utilisateurs/serveurs)", () => {
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(4);
    for (const item of FAQ_ITEMS) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
    const blob = JSON.stringify(FAQ_ITEMS);
    expect(blob).not.toMatch(/\b\d[\d\s.,]*\s*(utilisateurs|membres|serveurs|clients|avis)\b/i);
  });

  it("deux périodes de facturation avec notes distinctes", () => {
    expect(BILLING_PERIODS.map((p) => p.value)).toEqual(["monthly", "annual"]);
    expect(billingPeriodNote("monthly")).not.toBe(billingPeriodNote("annual"));
  });
});
