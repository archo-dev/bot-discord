import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("workspace Rôles (Lot 5A)", () => {
  const roles = readSource("../src/pages/Roles.tsx");
  const workspace = readSource("../src/components/modules/ModuleWorkspace.tsx");
  const preview = readSource("../src/components/previews/DiscordMessagePreview.tsx");
  const savebar = readSource("../src/ui/savebar.tsx");
  const overlay = readSource("../src/ui/overlay.tsx");

  it("compose les trois zones dans l’ordre mobile attendu", () => {
    expect(workspace.indexOf('id="module-configuration"')).toBeLessThan(workspace.indexOf('id="module-preview"'));
    expect(workspace.indexOf('id="module-preview"')).toBeLessThan(workspace.indexOf('id="module-publication"'));
    expect(workspace).toContain("lg:grid-cols-12");
    expect(workspace).toContain("xl:col-span-6");
    expect(workspace).toContain("xl:col-span-3");
  });

  it("préserve les lectures et les deux seules mutations existantes", () => {
    for (const key of ['"button-roles"', '"channels"', '"roles"', '"modules"']) {
      expect(roles).toContain(key);
    }
    expect(roles.match(/method:\s*"POST"/g)).toHaveLength(1);
    expect(roles.match(/method:\s*"DELETE"/g)).toHaveLength(1);
    expect(roles).not.toMatch(/method:\s*"(PUT|PATCH)"/);
  });

  it("ne déclenche aucun réseau depuis l’aperçu", () => {
    expect(preview).not.toMatch(/\b(api|fetch|useQuery|useMutation)\b/);
    expect(roles).toContain("buildRolesPreview(draft");
    expect(preview).toContain("Aperçu indicatif du message Discord");
    expect(preview).toContain("Réponse privée indicative");
  });

  it("garde tous les champs et comportements du formulaire historique", () => {
    for (const label of [
      "Salon cible",
      "Titre",
      "Description (optionnelle)",
      "Rôle attribué",
      "Libellé",
      "Emoji (optionnel)",
      "Couleur du bouton",
      "Un clic attribue le rôle ; un second clic le retire.",
    ]) {
      expect(roles).toContain(label);
    }
    expect(roles).toContain("25 boutons");
    expect(roles).toContain("STYLE_OPTIONS");
  });

  it("annonce dirty, publication, succès et erreur sans toast de formulaire", () => {
    expect(roles).toContain('actionLabel="Publier"');
    expect(roles).toContain('pendingLabel="Publication en cours"');
    expect(roles).toContain('dirtyLabel="Modifications non publiées"');
    expect(roles).toContain('successLabel="✓ Message publié"');
    expect(roles).toContain("publishErrorMessage(publish.error)");
    expect(roles).not.toContain("toast.success");
    expect(savebar).toContain('aria-live="polite"');
  });

  it("respecte lecture seule, permissions et Gateway non requise", () => {
    expect(roles).toContain("disabled={!canWrite || !moduleAllowsConfiguration}");
    expect(roles).toContain("Lecture seule");
    expect(roles).toContain("moduleAllowsConfiguration");
    expect(roles).toContain("Connectée · non requise");
    expect(roles).toContain("Indisponible · non bloquante");
  });

  it("conserve une confirmation destructive accessible avec erreur visible", () => {
    expect(roles).toContain("<ConfirmModal");
    expect(roles).toContain("Les rôles déjà attribués sont conservés.");
    expect(roles).toContain("deleteTrigger?.focus()");
    expect(overlay).toContain('role="alert"');
  });

  it("rend les textes longs et spéciaux sans injection HTML", () => {
    expect(preview).toContain("whitespace-pre-wrap");
    expect(preview).toContain("break-words");
    expect(preview).not.toContain("dangerouslySetInnerHTML");
  });
});
