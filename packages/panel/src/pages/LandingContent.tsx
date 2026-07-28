import { useDocumentMeta } from "../lib/seo.js";
import { Hero } from "../components/public/landing/Hero.js";
import { PlansTeaser } from "../components/public/landing/PlansTeaser.js";
import { Benefits, PanelPreview } from "../components/public/landing/sections.js";

/*
 * Landing commerciale condensée — corps de la vitrine, orienté résultats.
 * Composé de sections présentielles (components/public/landing/). Partagé par :
 *   - Landing (page autonome, /api/me 401 et site public désactivé) — chrome propre ;
 *   - la home publique sous PublicLayout (flag `platform.publicSite` ON).
 * Aucun prix, chiffre social ni témoignage inventé. Un seul <main>, un seul <h1>.
 */
export function LandingContent() {
  useDocumentMeta({
    title: "Archodev — pilotez votre serveur Discord sans friction",
    description:
      "Modération, communauté, automatisations et statistiques réunies dans un panel Discord clair, rapide et immédiatement compréhensible.",
  });

  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="grid items-center gap-10 pb-12 pt-10 md:pt-14 lg:grid-cols-[0.88fr_1.12fr] lg:gap-10 lg:pb-14 lg:pt-16 xl:gap-14">
        <Hero />
        <PanelPreview />
      </div>
      <Benefits />
      <PlansTeaser />
    </main>
  );
}
