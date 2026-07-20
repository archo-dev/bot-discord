import { describe, expect, it } from "vitest";
import { PLATFORM_FLAGS, resolveFlags, isFlagEnabled } from "@bot/shared";

/* Cible @bot/shared : mécanisme de feature flags de plateforme (M1). */
describe("platform feature flags", () => {
  it("sont TOUS désactivés par défaut (aucune source)", () => {
    const state = resolveFlags();
    for (const key of Object.keys(PLATFORM_FLAGS)) {
      expect(state[key as keyof typeof state]).toBe(false);
    }
  });

  it("le catalogue déclare un défaut false partout (M1)", () => {
    for (const def of Object.values(PLATFORM_FLAGS)) {
      expect(def.default).toBe(false);
    }
  });

  it("applique un override booléen d'une clé connue", () => {
    const state = resolveFlags({ "platform.publicSite": true });
    expect(state["platform.publicSite"]).toBe(true);
    expect(state["platform.entitlements"]).toBe(false);
    expect(isFlagEnabled("platform.publicSite", { "platform.publicSite": true })).toBe(true);
  });

  it("ignore les valeurs non booléennes et les clés inconnues (retour au défaut, jamais de crash)", () => {
    const state = resolveFlags({
      "platform.billing": "true" as unknown as boolean,
      "platform.unknown": true,
    } as Record<string, unknown>);
    expect(state["platform.billing"]).toBe(false);
    expect((state as Record<string, unknown>)["platform.unknown"]).toBeUndefined();
  });

  it("est pure : mêmes entrées → même sortie", () => {
    const src = { "platform.entitlements": true };
    expect(resolveFlags(src)).toEqual(resolveFlags(src));
  });
});
