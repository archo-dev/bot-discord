import { describe, expect, it } from "vitest";

/*
 * Filet de sécurité du code-splitting du SHELL PUBLIC (fix loading infini).
 * Même piège que lazy-routes.test.ts mais côté vitrine : un export nommé erroné
 * pour une page publique NE casse PAS le build (l'import dynamique résout) mais
 * fait planter la route au runtime (« element type is invalid ») — et comme ces
 * routes servent la home et les pages non authentifiées, la régression est
 * visible par tout visiteur. On importe chaque chunk public exactement comme
 * App.tsx et on vérifie que le composant attendu existe.
 */

const publicLazyRoutes: Array<{ path: string; load: () => Promise<Record<string, unknown>>; name: string }> = [
  { path: "PublicLayout", name: "PublicLayout", load: () => import("../src/layouts/PublicLayout.js") },
  { path: "PublicStubs", name: "FeaturesPage", load: () => import("../src/pages/public/PublicStubs.js") },
  { path: "PublicStubs", name: "StatusPage", load: () => import("../src/pages/public/PublicStubs.js") },
  { path: "PublicStubs", name: "LegalPage", load: () => import("../src/pages/public/PublicStubs.js") },
  { path: "Pricing", name: "PricingPage", load: () => import("../src/pages/public/Pricing.js") },
  { path: "Updates", name: "UpdatesPage", load: () => import("../src/pages/public/Updates.js") },
  { path: "UpdateDetail", name: "UpdateDetailPage", load: () => import("../src/pages/public/UpdateDetail.js") },
];

describe("public shell lazy chunks", () => {
  it.each(publicLazyRoutes)("$path exposes $name as a component", async ({ load, name }) => {
    const mod = await load();
    expect(typeof mod[name]).toBe("function");
  });

  it("LandingContent (import statique de la home) reste un composant", async () => {
    const mod = await import("../src/pages/LandingContent.js");
    expect(typeof mod.LandingContent).toBe("function");
  });
});
