import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("workspaces communautaires (Lot 5B)", () => {
  const welcome = readSource("../src/pages/Welcome.tsx");
  const starboard = readSource("../src/pages/Starboard.tsx");
  const previews = readSource("../src/components/previews/CommunityPreviews.tsx");
  const levels = readSource("../src/pages/Levels.tsx");
  const tempVoice = readSource("../src/pages/TempVoice.tsx");

  it("réutilise la structure en trois zones et le même panneau d’état", () => {
    for (const page of [welcome, starboard]) {
      expect(page).toContain("<ModuleWorkspace");
      expect(page).toContain("<ModuleStatusPanel");
      expect(page).toContain("configuration={");
      expect(page).toContain("preview={");
      expect(page).toContain("context={");
    }
  });

  it("préserve strictement les lectures et mutations historiques de Bienvenue", () => {
    for (const endpoint of ["/welcome", "/log-settings", "/channels", "/modules"]) {
      expect(welcome).toContain(endpoint);
    }
    expect(welcome.match(/method:\s*"PUT"/g)).toHaveLength(2);
    expect(welcome).not.toMatch(/method:\s*"(POST|PATCH|DELETE)"/);
    expect(welcome.indexOf('method: "PUT"')).toBeLessThan(welcome.lastIndexOf('method: "PUT"'));
  });

  it("conserve tous les champs, variables et neuf événements de Bienvenue", () => {
    for (const label of [
      "Message de bienvenue",
      "Message de départ",
      "Salon cible",
      "Journaux serveur",
      "Salon des journaux",
      "Arrivées de membres",
      "Départs de membres",
      "Messages supprimés",
      "Messages modifiés",
      "Membres modifiés (surnom, rôles)",
      "Vocal — arrivées dans un salon",
      "Vocal — départs d’un salon",
      "Vocal — changements de salon",
      "Vocal — muet / casque coupé",
    ]) {
      expect(welcome).toContain(label);
    }
    for (const variable of ["{mention}", "{user}", "{user.id}", "{server}", "{membercount}"]) {
      expect(welcome).toContain(variable);
    }
    expect(welcome).toContain("maxLength={2000}");
  });

  it("préserve le seul contrat PUT et tous les champs historiques du Starboard", () => {
    expect(starboard).toContain("/starboard-settings");
    expect(starboard).toContain("/channels");
    expect(starboard).toContain("/modules");
    expect(starboard.match(/method:\s*"PUT"/g)).toHaveLength(1);
    expect(starboard).not.toMatch(/method:\s*"(POST|PATCH|DELETE)"/);
    for (const field of ["draft.enabled", "draft.channelId", "draft.threshold", "draft.emoji"]) {
      expect(starboard).toContain(field);
    }
    expect(starboard).toContain("min={1}");
    expect(starboard).toContain("max={50}");
    expect(starboard).toContain("maxLength={64}");
  });

  it("documente les règles réelles du Starboard sans ajouter de lecture d’historique", () => {
    for (const rule of [
      "Les réactions des bots ne sont pas comptées.",
      "L’auteur ne peut pas promouvoir son propre message.",
      "Les messages du salon Starboard sont exclus.",
      "supprimé sous le seuil",
      "ne charge ni publication Starboard, ni historique",
    ]) {
      expect(starboard).toContain(rule);
    }
    expect(starboard).not.toMatch(/\/(?:history|messages|publications)\b/);
  });

  it("génère les deux aperçus sans aucun accès réseau ni HTML injecté", () => {
    expect(previews).toContain("Démonstration locale");
    expect(previews).toContain("Aucun message réel du serveur n’est chargé");
    expect(previews).toContain("Aucun message configuré");
    expect(previews).not.toMatch(/\b(api|fetch|useQuery|useMutation)\b/);
    expect(previews).not.toContain("dangerouslySetInnerHTML");
    expect(welcome).toContain("buildWelcomePreview");
    expect(starboard).toContain("buildStarboardPreview");
  });

  it("rend les états Gateway, lecture seule, capacité manquante et module désactivé", () => {
    for (const page of [welcome, starboard]) {
      expect(page).toContain("Gateway indisponible");
      expect(page).toContain("Lecture seule");
      expect(page).toContain("moduleAllowsConfiguration");
      expect(page).toContain("Module désactivé");
      expect(page).toContain("disabled={!canWrite || !moduleAllowsConfiguration}");
      expect(page).toContain("meta: { silentError: true }");
      expect(page).toContain("Le brouillon est conservé");
    }
  });

  it("laisse Niveaux et Salons temporaires hors périmètre après audit UX", () => {
    expect(levels).not.toContain("ModuleWorkspace");
    expect(tempVoice).not.toContain("ModuleWorkspace");
    expect(levels).not.toContain("CommunityPreviews");
    expect(tempVoice).not.toContain("CommunityPreviews");
  });
});
