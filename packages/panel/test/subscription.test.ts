import { describe, expect, it } from "vitest";
import {
  countSuspended,
  entitlementSourceLabel,
  featureAccessMessage,
  formatDateTime,
  showGlobalEarlyAccessNote,
  subscriptionSourceLabel,
} from "../src/lib/subscription.js";

/* Cible les helpers PURS de l'espace abonnement/compte (M8). */

describe("subscription display helpers (M8)", () => {
  it("explique l'accès bêta sans modifier le plan affiché", () => {
    expect(featureAccessMessage("early_access")).toBe(
      "Toutes les fonctionnalités client sont débloquées pendant la bêta.",
    );
    expect(featureAccessMessage("plan_enforced")).toBeNull();
  });

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

describe("origine affichée sur « Mon abonnement » (fix accès anticipé)", () => {
  it("Business Lifetime offert → « Lifetime offert », jamais « Accès anticipé »", () => {
    expect(subscriptionSourceLabel("granted", true)).toBe("Lifetime offert");
    // Un entitlement explicite (source ≠ null) masque la note globale early_access.
    expect(showGlobalEarlyAccessNote("early_access", "granted")).toBe(false);
  });

  it("early_access réel → « Accès bêta »", () => {
    expect(subscriptionSourceLabel("early_access", false)).toBe("Accès bêta");
  });

  it("l'entitlement explicite prime toujours sur le mode global early_access", () => {
    for (const source of ["paid", "granted", "trial", "promotion", "partner"] as const) {
      expect(showGlobalEarlyAccessNote("early_access", source)).toBe(false);
    }
    // Aucun entitlement (Gratuit implicite) → la note globale reste possible.
    expect(showGlobalEarlyAccessNote("early_access", null)).toBe(true);
    expect(showGlobalEarlyAccessNote("plan_enforced", null)).toBe(false);
  });

  it("libellés d'origine conformes aux règles cibles", () => {
    expect(subscriptionSourceLabel("granted", false)).toBe("Accès offert");
    expect(subscriptionSourceLabel("promotion", false)).toBe("Accès promotionnel");
    expect(subscriptionSourceLabel("trial", false)).toBe("Essai");
    expect(subscriptionSourceLabel("paid", false)).toBe("Abonnement");
    expect(subscriptionSourceLabel(null, false)).toBe("Offre gratuite");
  });
});
