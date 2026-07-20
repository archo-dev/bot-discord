import { PLAN_TIERS, serversLabel } from "../../../lib/plans.js";
import { Button } from "../../../ui/kit.js";
import { Icon } from "../../../ui/icons.js";
import { billingPeriodNote, type BillingPeriod } from "./data.js";

/* Cartes d'offres (M4). Prix = « Tarifs à venir » (D1 ouverte) ; la période
   ne change qu'une note structurelle, aucune valeur inventée. */
export function PricingCards({ period }: { period: BillingPeriod }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
          <div className="mt-4">
            <span className="text-2xl font-semibold text-zinc-100">Tarifs à venir</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{billingPeriodNote(period)} · {serversLabel(plan.servers)}</p>
          <ul className="mt-5 flex-1 space-y-2 text-[13px] text-zinc-300">
            {plan.benefits.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2">
                <span className="mt-0.5 text-indigo-400 [&_svg]:h-4 [&_svg]:w-4" aria-hidden><Icon.star /></span>
                {benefit}
              </li>
            ))}
          </ul>
          <div className="mt-5 border-t border-zinc-800/70 pt-4 text-xs text-zinc-400">{plan.support}</div>
          <Button href="/auth/login" variant={plan.highlighted ? "primary" : "secondary"} size="md" className="mt-5 w-full">
            Commencer
          </Button>
        </div>
      ))}
    </div>
  );
}
