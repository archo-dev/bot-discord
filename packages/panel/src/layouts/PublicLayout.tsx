import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { PublicHeader } from "../components/public/PublicHeader.js";
import { PublicFooter } from "../components/public/PublicFooter.js";

/*
 * Shell public (M2) : en-tête de marque + navigation + pied de page.
 * Distinct de GuildLayout (espace connecté). Chaque page fournit son propre
 * <main> ; ce layout n'en pose pas (évite un double landmark).
 *
 * Deux usages :
 *   - route de layout : `<Route element={<PublicLayout/>}>` → rend <Outlet/> ;
 *   - wrapper direct  : `<PublicLayout><LandingContent/></PublicLayout>` → rend children.
 * Monté uniquement quand le flag `platform.publicSite` est ON.
 */
export function PublicLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <div className="flex-1">{children ?? <Outlet />}</div>
      <PublicFooter />
    </div>
  );
}
