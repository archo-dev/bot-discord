/*
 * Taxonomie des routes publiques (M2 — shell public).
 * Module PUR (aucune dépendance React/DOM) → testable en node, comme la nav.
 * Reflète la décision de routage d'App.tsx :
 *   - flag OFF  → tout est « connected » (comportement historique, inchangé) ;
 *   - flag ON   → chemins publics dédiés = « public » ; racine = « root »
 *                 (dépend de l'auth au runtime) ; le reste = « connected ».
 * Voir docs/platform-split/execution/briefs/M2-brief.md.
 */

/** Chemins publics dédiés (hors racine). Additifs : n'entrent pas en conflit avec l'existant. */
export const PUBLIC_PATHS = ["/features", "/pricing", "/updates", "/status"] as const;
export type PublicPath = (typeof PUBLIC_PATHS)[number];

const LEGAL_PREFIX = "/legal";
// Chemins publics à sous-arbre (détail par slug) : /updates/:slug (M5).
const PREFIX_PATHS = [LEGAL_PREFIX, "/updates"] as const;

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/** Un chemin correspond-il à une route publique dédiée (hors racine `/`) ? */
export function isPublicPath(pathname: string): boolean {
  const path = normalize(pathname);
  if ((PUBLIC_PATHS as readonly string[]).includes(path)) return true;
  return PREFIX_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export type Shell = "public" | "root" | "connected";

/**
 * Décision de shell (pure) — miroir testable d'App.tsx.
 * `publicSite` = état résolu du flag `platform.publicSite`.
 */
export function resolveShell(pathname: string, opts: { publicSite: boolean }): Shell {
  if (!opts.publicSite) return "connected";
  if (isPublicPath(pathname)) return "public";
  if (normalize(pathname) === "/") return "root";
  return "connected";
}
