import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("dashboard connecté dense (Lot 3)", () => {
  const dashboard = readSource("../src/pages/Dashboard.tsx");
  const grid = readSource("../src/components/dashboard/DashboardGrid.tsx");
  const dashboardCharts = readSource("../src/components/charts/DashboardCharts.tsx");
  const viewModel = readSource("../src/pages/dashboard-view-model.ts");
  const skeleton = readSource("../src/ui/skeleton.tsx");

  it("réutilise uniquement les clés de cache existantes nécessaires", () => {
    for (const key of ["stats-members", "stats-presence", "stats-events", "health", "mod-actions"]) {
      expect(dashboard).toContain(`"${key}"`);
    }
    expect(dashboard).not.toContain('"stats-channels"');
    expect(dashboard).not.toContain('"channels"');
    expect(dashboard).not.toContain('"onboarding"');
  });

  it("isole les échecs secondaires et n’agrège jamais toutes les sources avec Promise.all", () => {
    expect(dashboard).toContain("Promise.allSettled");
    expect(dashboard).not.toMatch(/Promise\.all\(/);
    expect(dashboardCharts).toContain("Impossible de charger les événements programmés.");
    expect(grid).toContain("Impossible de charger la santé du serveur.");
    expect(grid).toContain("Impossible de charger la modération récente.");
  });

  it("ne calcule jamais Messages 24 h depuis un classement partiel", () => {
    expect(viewModel).toContain('label: "Messages 24 h"');
    expect(viewModel).toContain('value: "—"');
    expect(viewModel).toContain('hint: "Total exact indisponible"');
    expect(dashboard).not.toContain("topMessages");
    expect(grid).not.toContain("topMessages");
  });

  it("ne fabrique ni alerte persistante ni activité unifiée", () => {
    expect(viewModel).toContain("Aucun domaine d’alertes persistantes configuré");
    expect(grid).toContain("Aucun flux métier unifié n’est exposé.");
    expect(grid).toContain("Les événements programmés ne sont pas présentés comme une activité métier récente.");
  });

  it("garde Recharts dans le chunk différé de Stats", () => {
    expect(dashboard).not.toMatch(/recharts|ui\/charts/);
    expect(grid).not.toMatch(/recharts|ui\/charts/);
  });

  it("reproduit la grille finale dans le skeleton", () => {
    expect(skeleton).toContain("4 KPI, 3 aperçus et 4 cartes de pilotage");
    expect(skeleton).toContain("xl:grid-cols-12");
    expect(skeleton).toContain("xl:grid-cols-4");
    expect(skeleton).toContain('aria-busy="true"');
  });
});
