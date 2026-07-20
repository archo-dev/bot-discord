import { useDocumentMeta } from "../lib/seo.js";
import { getPlatformFlags } from "../lib/flags.js";
import { Hero } from "../components/public/landing/Hero.js";
import { PlansTeaser } from "../components/public/landing/PlansTeaser.js";
import { LatestUpdates } from "../components/public/landing/LatestUpdates.js";
import {
  ValueProp,
  Benefits,
  FeaturesOverview,
  UseCases,
  Centralized,
  Trust,
  FinalCta,
} from "../components/public/landing/sections.js";

/*
 * Landing commerciale (M3) — corps de la vitrine, orienté résultats.
 * Composé de sections présentielles (components/public/landing/). Partagé par :
 *   - Landing (page autonome, /api/me 401) — chrome propre ;
 *   - la home publique sous PublicLayout (flag `platform.publicSite` ON).
 * Aucun prix, aucun chiffre inventé, aucun témoignage. Un seul <main>, un seul <h1>.
 */
export function LandingContent() {
  useDocumentMeta({
    title: "Archodev — bot Discord tout-en-un",
    description:
      "Animez, modérez et gérez votre serveur Discord depuis un panel web clair : accueil, auto-modération, niveaux, tickets, musique et automatisations. Gratuit pour commencer.",
  });

  // Aperçu des mises à jour : partie du site public → gardé par le même flag,
  // donc absent (et sans requête) en production tant que le site public est off.
  const publicSite = getPlatformFlags()["platform.publicSite"];

  return (
    <main className="relative mx-auto max-w-6xl px-4 sm:px-6">
      <Hero />
      <ValueProp />
      <Benefits />
      <FeaturesOverview />
      <UseCases />
      <Centralized />
      <PlansTeaser />
      {publicSite && <LatestUpdates />}
      <Trust />
      <FinalCta />
    </main>
  );
}
