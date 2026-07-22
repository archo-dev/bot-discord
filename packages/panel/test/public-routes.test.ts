import { describe, expect, it } from "vitest";
import { PUBLIC_PATHS, isPublicPath, resolveShell, shouldRenderPublicHome } from "../src/lib/public-routes.js";

describe("public route taxonomy (M2)", () => {
  it("reconnaît les chemins publics dédiés (+ legal)", () => {
    for (const p of PUBLIC_PATHS) expect(isPublicPath(p)).toBe(true);
    expect(isPublicPath("/legal")).toBe(true);
    expect(isPublicPath("/legal/mentions")).toBe(true);
    expect(isPublicPath("/legal/privacy")).toBe(true);
  });

  it("ne considère PAS la racine ni les routes connectées comme publiques", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/guilds/123")).toBe(false);
    expect(isPublicPath("/guilds/123/music")).toBe(false);
  });

  it("ignore un slash final", () => {
    expect(isPublicPath("/features/")).toBe(true);
    expect(isPublicPath("/legal/")).toBe(true);
  });

  it("reconnaît le détail des mises à jour /updates/:slug (M5)", () => {
    expect(isPublicPath("/updates")).toBe(true);
    expect(isPublicPath("/updates/v1-0-0")).toBe(true);
    expect(isPublicPath("/updates/v1-0-0/")).toBe(true);
    expect(resolveShell("/updates/v1-0-0", { publicSite: true })).toBe("public");
    expect(resolveShell("/updates/v1-0-0", { publicSite: false })).toBe("connected");
    // Pas de faux positif : « /updatesX » n'est pas un sous-chemin de /updates.
    expect(isPublicPath("/updatesX")).toBe(false);
  });

  it("flag OFF → toujours « connected » (comportement historique)", () => {
    for (const p of ["/", "/features", "/pricing", "/legal/privacy", "/guilds/1"]) {
      expect(resolveShell(p, { publicSite: false })).toBe("connected");
    }
  });

  it("flag ON → répartit public / root / connected", () => {
    expect(resolveShell("/features", { publicSite: true })).toBe("public");
    expect(resolveShell("/pricing", { publicSite: true })).toBe("public");
    expect(resolveShell("/legal/privacy", { publicSite: true })).toBe("public");
    expect(resolveShell("/", { publicSite: true })).toBe("root");
    expect(resolveShell("/guilds/1", { publicSite: true })).toBe("connected");
    expect(resolveShell("/guilds/1/music", { publicSite: true })).toBe("connected");
  });
});

describe("home publique sans blocage sur /api/me (fix loading infini)", () => {
  it("rend la vitrine dès que le site public est actif et le visiteur non authentifié", () => {
    // Cas central du bug : `/` avec /api/me encore en attente (authenticated=false)
    // → on rend la home publique, on NE bloque PAS sur la requête auth.
    expect(shouldRenderPublicHome("/", { publicSite: true, authenticated: false })).toBe(true);
    expect(shouldRenderPublicHome("/", { publicSite: true, authenticated: false })).toBe(true);
  });

  it("ignore un slash final sur la racine", () => {
    expect(shouldRenderPublicHome("/", { publicSite: true, authenticated: false })).toBe(true);
  });

  it("visiteur authentifié → NE rend PAS la home publique (bascule dashboard)", () => {
    expect(shouldRenderPublicHome("/", { publicSite: true, authenticated: true })).toBe(false);
  });

  it("site public OFF → jamais de home publique (comportement historique)", () => {
    expect(shouldRenderPublicHome("/", { publicSite: false, authenticated: false })).toBe(false);
    expect(shouldRenderPublicHome("/", { publicSite: false, authenticated: true })).toBe(false);
  });

  it("ne s'applique qu'à la racine, pas aux autres chemins", () => {
    for (const p of ["/features", "/pricing", "/guilds/1", "/updates/v1"]) {
      expect(shouldRenderPublicHome(p, { publicSite: true, authenticated: false })).toBe(false);
    }
  });
});
