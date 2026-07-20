import { useState } from "react";
import { useDocumentMeta } from "../../lib/seo.js";
import { SegmentedControl } from "../../ui/kit.js";
import { PLANS_DIRECTIVE } from "../../lib/plans.js";
import { PricingCards } from "../../components/public/pricing/PricingCards.js";
import { ComparisonTable } from "../../components/public/pricing/ComparisonTable.js";
import { PricingFaq } from "../../components/public/pricing/PricingFaq.js";
import { BILLING_PERIODS, type BillingPeriod } from "../../components/public/pricing/data.js";

/*
 * Page pricing (M4) — cartes + comparatif + toggle mensuel/annuel + FAQ.
 * Route publique lazy (chunk séparé) → bundle initial inchangé. AUCUN prix.
 * Un seul <main>, un seul <h1>.
 */
export function PricingPage() {
  useDocumentMeta({
    title: "Tarifs — Archodev",
    description: "Comparez les offres Gratuit, Premium et Business d'Archodev. Trois niveaux clairs pour animer, modérer et gérer votre serveur Discord.",
  });
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="text-center">
        <h1 className="font-display text-4xl font-semibold tracking-[-0.02em] text-zinc-50">Des offres claires, pour chaque communauté</h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">{PLANS_DIRECTIVE}</p>
        <div className="mt-6 flex justify-center">
          <SegmentedControl
            ariaLabel="Période de facturation"
            options={BILLING_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            value={period}
            onChange={setPeriod}
          />
        </div>
      </div>

      <section aria-labelledby="offers-title" className="mt-10">
        <h2 id="offers-title" className="sr-only">Nos offres</h2>
        <PricingCards period={period} />
      </section>

      <section aria-labelledby="compare-title" className="mt-16">
        <h2 id="compare-title" className="text-center font-display text-2xl font-semibold text-zinc-100">Comparatif détaillé</h2>
        <div className="mt-8">
          <ComparisonTable />
        </div>
      </section>

      <section aria-labelledby="faq-title" className="mt-16">
        <h2 id="faq-title" className="text-center font-display text-2xl font-semibold text-zinc-100">Questions fréquentes</h2>
        <div className="mt-8">
          <PricingFaq />
        </div>
      </section>
    </main>
  );
}
