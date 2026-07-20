import { describe, expect, it } from "vitest";
import { badgeToneClass, type BadgeTone } from "@bot/ui";

/* Cible @bot/ui : mapping ton → classes de la primitive Badge (pur, sans DOM). */
describe("@bot/ui Badge tone mapping", () => {
  const tones: BadgeTone[] = ["primary", "success", "warning", "danger", "neutral"];

  it("expose une classe de fond + texte pour chaque ton", () => {
    for (const tone of tones) {
      const cls = badgeToneClass(tone);
      expect(cls).toMatch(/^bg-\w/);
      expect(cls).toContain("text-");
    }
  });

  it("conserve exactement le rendu Nocturne d'origine", () => {
    expect(badgeToneClass("primary")).toBe("bg-indigo-950 text-indigo-200");
    expect(badgeToneClass("success")).toBe("bg-green-950 text-green-300");
    expect(badgeToneClass("warning")).toBe("bg-amber-950 text-amber-200");
    expect(badgeToneClass("danger")).toBe("bg-red-950 text-red-300");
    expect(badgeToneClass("neutral")).toBe("bg-zinc-800 text-zinc-400");
  });
});
