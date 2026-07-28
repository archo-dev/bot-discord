import { Link } from "react-router";
import { Button } from "../../../ui/kit.js";
import { PLAN_TIERS, PLANS_DIRECTIVE, serversLabel } from "../../../lib/plans.js";

/*
 * Présentation LÉGÈRE des trois offres (M3). Premium mis en avant.
 * Aucun prix (décision D1 ouverte) → « Tarifs à venir ». Le comparatif
 * détaillé est la page /pricing (M4). CTA « Commencer » → connexion.
 */
export function PlansTeaser() {
  return (
    <section id="offres" aria-labelledby="offres-title" className="scroll-mt-20 py-10 lg:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">Tarifs</div>
          <h2 id="offres-title" className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em] text-zinc-50 sm:text-3xl">
            Une offre pour chaque étape
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">{PLANS_DIRECTIVE}</p>
        </div>
        <Button to="/pricing" variant="secondary" size="sm" className="self-start shrink-0 sm:self-auto">
          Comparer les offres
        </Button>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3">
        {PLAN_TIERS.map((plan) => (
          <article
            key={plan.id}
            className={`relative rounded-xl border p-5 ${
              plan.highlighted
                ? "border-indigo-500/45 bg-[linear-gradient(150deg,rgba(107,78,242,0.16),rgba(22,20,31,0.9))]"
                : "border-zinc-800/90 bg-zinc-900/45"
            }`}
          >
            {plan.highlighted && (
              <span className="absolute right-4 top-4 rounded-full bg-indigo-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-200">
                Recommandé
              </span>
            )}
            <h3 className="pr-24 font-display text-lg font-semibold text-zinc-100">{plan.name}</h3>
            <p className="mt-1 text-[13px] text-zinc-400">{plan.tagline}</p>
            <p className="mt-4 text-sm font-medium text-zinc-200">{serversLabel(plan.servers)}</p>
            <p className="mt-1 text-xs text-zinc-500">{plan.support} · Tarifs à venir</p>
            <Link
              to="/pricing"
              className="mt-3 inline-flex min-h-10 items-center rounded-md text-xs font-semibold text-indigo-300 transition hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
            >
              Détails de l'offre <span className="ml-1" aria-hidden>→</span>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
