import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("charte graphique partagée (Lot 4)", () => {
  const app = readSource("../src/App.tsx");
  const dashboard = readSource("../src/pages/Dashboard.tsx");
  const grid = readSource("../src/components/dashboard/DashboardGrid.tsx");
  const dashboardCharts = readSource("../src/components/charts/DashboardCharts.tsx");
  const chartCard = readSource("../src/components/charts/ChartCard.tsx");
  const charts = readSource("../src/ui/charts.tsx");
  const stats = readSource("../src/pages/Stats.tsx");

  it("keeps Recharts out of the eager dashboard graph", () => {
    expect(dashboard).not.toMatch(/recharts|ui\/charts/);
    expect(grid).not.toMatch(/from\s+["'].*ui\/charts/);
    expect(grid).toContain('lazy(() =>');
    expect(grid).toContain('import("../charts/DashboardCharts.js")');
    expect(charts).toContain('from "recharts"');
  });

  it("keeps Stats lazy while sharing the same chart components", () => {
    expect(app).toContain('lazy(() => import("./pages/Stats.js")');
    for (const component of ["ActivityAreaChart", "RankedBarChart", "PresenceDonut"]) {
      expect(stats).toContain(component);
    }
    expect(dashboardCharts).toContain("ActivityAreaChart");
    expect(dashboardCharts).toContain("RankedBarChart");
    expect(dashboardCharts).toContain("PresenceDonut");
  });

  it("offers all validated activity periods", () => {
    for (const period of [7, 30, 90]) {
      expect(dashboardCharts).toContain(`value: ${period} as ChartPeriod`);
      expect(stats).toContain(`value: ${period} as ChartPeriod`);
    }
  });

  it("provides common loading, error, empty and accessible summary states", () => {
    expect(chartCard).toContain("loading");
    expect(chartCard).toContain("ChartError");
    expect(chartCard).toContain("ChartEmpty");
    expect(chartCard).toContain("Résumé :");
    expect(chartCard).toContain("aria-labelledby");
    expect(chartCard).toContain("aria-describedby");
  });

  it("disables chart animation when reduced motion is requested", () => {
    expect(charts).toContain("prefers-reduced-motion: reduce");
    expect(charts).toContain("isAnimationActive={!reducedMotion}");
    expect(charts).toContain("accessibilityLayer");
  });

  it("keeps essential values outside tooltips", () => {
    expect(charts).toContain("Données du graphique");
    expect(charts).toContain("formatValue(item.value)");
    expect(charts).toContain("slice.percentage");
    expect(charts).toContain("tabular-nums");
  });
});
