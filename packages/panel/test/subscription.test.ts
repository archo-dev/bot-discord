import { describe, expect, it } from "vitest";
import { countSuspended, entitlementSourceLabel, formatDateTime } from "../src/lib/subscription.js";

/* Cible les helpers PURS de l'espace abonnement/compte (M8). */

describe("subscription display helpers (M8)", () => {
  it("libellé FR de l'origine (null = gratuit)", () => {
    expect(entitlementSourceLabel(null)).toBe("Offre gratuite");
    expect(entitlementSourceLabel("paid")).toBe("Abonnement payant");
    expect(entitlementSourceLabel("granted")).toBe("Accès offert");
    expect(entitlementSourceLabel("trial")).toBe("Essai");
    expect(entitlementSourceLabel("promotion")).toBe("Promotion");
    expect(entitlementSourceLabel("partner")).toBe("Partenariat");
  });

  it("formate une date/heure ISO en français, vide si invalide", () => {
    expect(formatDateTime("2026-07-20T10:00:00.000Z")).toMatch(/2026/);
    expect(formatDateTime("pas-une-date")).toBe("");
    expect(formatDateTime("")).toBe("");
  });

  it("compte les affectations suspendues", () => {
    expect(
      countSuspended([{ state: "active" }, { state: "suspended" }, { state: "suspended" }]),
    ).toBe(2);
    expect(countSuspended([])).toBe(0);
  });
});
