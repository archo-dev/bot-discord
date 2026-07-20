import { Button } from "../../../ui/kit.js";
import { Icon } from "../../../ui/icons.js";
import { PLAN_TIERS, PLANS_DIRECTIVE, serversLabel } from "../../../lib/plans.js";

/*
 * Présentation LÉGÈRE des trois offres (M3). Premium mis en avant.
 * Aucun prix (décision D1 ouverte) → « Tarifs à venir ». Le comparatif
 * détaillé est la page /pricing (M4). CTA « Commencer » → connexion.
 */
export function PlansTeaser() {
  return (
    <section id="offres" aria-labelledby="offres-title" className="scroll-mt-20 py-16">
      <div className="text-center">
        <h2 id="offres-title" className="font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50">Trois offres, une progression claire</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">{PLANS_DIRECTIVE}</p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {PLAN_TIERS.map((plan) => (
          <div
            key={plan.id}
            className={`relative flex flex-col rounded-2xl border p-6 shadow-(--shadow-card) ${
              plan.highlighted ? "border-indigo-500/60 bg-[linear-gradient(160deg,rgba(107,78,242,0.12),rgba(22,20,31,0.9))]" : "border-zinc-800/90 bg-zinc-900/50"
            }`}
          >
            {plan.highlighted && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-500 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                Recommandé
              </span>
            )}
            <h3 className="font-display text-xl font-semibold text-zinc-100">{plan.name}</h3>
            <p className="mt-1 text-sm text-zinc-400">{plan.tagline}</p>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-zinc-100">{serversLabel(plan.servers)}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Tarifs à venir</p>
            <ul className="mt-5 flex-1 space-y-2 text-[13px] text-zinc-300">
              {plan.benefits.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2">
                  <span className="mt-0.5 text-indigo-400 [&_svg]:h-4 [&_svg]:w-4" aria-hidden><Icon.star /></span>
                  {benefit}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-col gap-1.5 border-t border-zinc-800/70 pt-4 text-xs text-zinc-400">
              <span>{plan.support}</span>
            </div>
            <Button
              href="/auth/login"
              variant={plan.highlighted ? "primary" : "secondary"}
              size="md"
              className="mt-5 w-full"
            >
              Commencer
            </Button>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-zinc-500">
        « Toutes les fonctionnalités » désigne les fonctions destinées aux utilisateurs. Les prix seront annoncés prochainement.
      </p>
    </section>
  );
}
