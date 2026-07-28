import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("responsive polish (Lot 7)", () => {
  it("uses mobile cards for the remaining dense server tables", () => {
    for (const page of ["Levels", "VoiceLog", "Sanctions"]) {
      const source = read(`../src/pages/${page}.tsx`);
      expect(source, page).toContain("data-mobile-card");
      expect(source, page).toContain("md:hidden");
      expect(source, page).toMatch(/hidden[^"]*md:block/);
    }
  });

  it("bounds overlays and the navigation drawer to the dynamic viewport", () => {
    const overlay = read("../src/ui/overlay.tsx");
    const guildLayout = read("../src/pages/GuildLayout.tsx");
    expect(overlay).toContain("100dvh");
    expect(overlay).toContain("overscroll-contain");
    expect(overlay).toContain("safe-area-inset-bottom");
    expect(guildLayout).toContain("h-[100dvh]");
    expect(guildLayout).toContain("max-h-[100dvh]");
  });

  it("stacks SaveBar and destructive modal actions on very small screens", () => {
    const savebar = read("../src/ui/savebar.tsx");
    const overlay = read("../src/ui/overlay.tsx");
    expect(savebar).toContain("flex-col");
    expect(savebar).toContain("min-[360px]:flex-row");
    expect(overlay).toContain("flex-col-reverse");
    expect(overlay).toContain("min-[360px]:flex-row");
  });

  it("keeps horizontal tables internally contained and keyboard reachable", () => {
    const navigation = read("../src/ui/kit/navigation.tsx");
    expect(navigation).toContain("overscroll-x-contain");
    expect(navigation).toContain('role="region"');
    expect(navigation).toContain("tabIndex={0}");
  });

  it("keeps shared controls at a usable touch size", () => {
    const forms = read("../src/ui/kit/forms.tsx");
    const combobox = read("../src/ui/combobox.tsx");
    const overlay = read("../src/ui/overlay.tsx");
    expect(forms).toContain("h-8 w-12");
    expect(combobox).toContain("h-8 w-8");
    expect(overlay).toContain("h-10 w-10");
  });

  it("gives standalone filters and entity comboboxes an accessible name", () => {
    const combobox = read("../src/ui/combobox.tsx");
    const entities = read("../src/ui/entity-select.tsx");
    expect(combobox).toContain("aria-label={ariaLabel}");
    expect(entities.match(/ariaLabel=\{ariaLabel\}/g)).toHaveLength(3);

    const checks: Array<[string, string]> = [
      ["Config", 'ariaLabel="Salon des logs de modération"'],
      ["PanelAccess", 'aria-label="ID utilisateur Discord à autoriser"'],
      ["Levels", "ariaLabel={`Rôle attribué par la récompense ${i + 1}`}"],
      ["Automod", 'aria-label="Mots et expressions interdits"'],
      ["Sanctions", 'ariaLabel="Filtrer par membre concerné"'],
      ["VoiceLog", 'aria-label="Filtrer les logs vocaux par action"'],
      ["AutomationEditor", 'aria-label="Contexte JSON de simulation"'],
    ];
    for (const [page, marker] of checks) {
      expect(read(`../src/pages/${page}.tsx`), page).toContain(marker);
    }
  });

  it("keeps favorite and primary navigation tooltip ids unique", () => {
    const sidebar = read("../src/components/navigation/GuildSidebar.tsx");
    expect(sidebar).toContain('tooltipScope="favorite"');
    expect(sidebar).toContain('tooltipScope?: string');
    expect(sidebar).toContain(
      '`nav-tooltip-${tooltipScope ? `${tooltipScope}-` : ""}${destination.id}`',
    );
  });

  it("announces global and server not-found pages with structured headings", () => {
    const app = read("../src/App.tsx");
    expect(app).toContain('<h1 className="sr-only">Page introuvable</h1>');
    expect(app).toContain('<h2 className="sr-only">Page du serveur introuvable</h2>');
  });
});
