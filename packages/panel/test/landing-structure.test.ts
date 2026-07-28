import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("landing publique condensée (Lot 1)", () => {
  it("conserve le titre et les deux CTA validés", () => {
    const hero = readSource("../src/components/public/landing/Hero.tsx");

    expect(hero).toContain("Pilotez votre serveur Discord sans friction");
    expect(hero).toContain('href="/auth/login"');
    expect(hero).toContain('href="#apercu-panel"');
    expect(hero).toContain("Se connecter avec Discord");
    expect(hero).toContain("Voir la démo");
    expect(hero).not.toContain("/api/invite");
  });

  it("rend uniquement les sections condensées sur la home", () => {
    const landing = readSource("../src/pages/LandingContent.tsx");

    expect(landing).toContain("<Hero />");
    expect(landing).toContain("<PanelPreview />");
    expect(landing).toContain("<Benefits />");
    expect(landing).toContain("<PlansTeaser />");
    expect(landing).not.toContain("<FeaturesOverview />");
    expect(landing).not.toContain("<UseCases />");
    expect(landing).not.toContain("<LatestUpdates />");
    expect(landing).not.toContain("<Trust />");
  });

  it("conserve toutes les destinations du header public", () => {
    const nav = readSource("../src/components/public/PublicNav.tsx");

    for (const route of ["/features", "/pricing", "/updates", "/status"]) {
      expect(nav).toContain(`to: "${route}"`);
    }
  });

  it("identifie l'aperçu comme illustratif sans chiffre social", () => {
    const sections = readSource("../src/components/public/landing/sections.tsx");

    expect(sections).toContain("Démonstration");
    expect(sections).toContain("aucune donnée de serveur réelle");
    expect(sections).not.toMatch(/\b\d[\d\s.,]*\s*(utilisateurs|membres|serveurs|clients|avis)\b/i);
  });
});
