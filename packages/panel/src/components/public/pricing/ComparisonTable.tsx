import { PLAN_TIERS } from "../../../lib/plans.js";
import { PlanBadge } from "../../PlanBadge.js";
import { PLAN_COMPARISON } from "./data.js";

/* Comparatif détaillé (M4). Table accessible (<th scope>), défilement horizontal
   isolé sur mobile — la page ne défile jamais horizontalement. Aucun prix. */
export function ComparisonTable() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-800/90">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">Comparatif des fonctionnalités par offre</caption>
        <thead>
          <tr className="border-b border-zinc-800">
            <th scope="col" className="px-4 py-3 text-left font-semibold text-zinc-400">Fonctionnalité</th>
            {PLAN_TIERS.map((plan) => (
              <th key={plan.id} scope="col" className="px-4 py-3 text-center">
                <PlanBadge plan={plan.id} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLAN_COMPARISON.map((row) => (
            <tr key={row.label} className="border-b border-zinc-800/60 last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-medium text-zinc-300">{row.label}</th>
              {PLAN_TIERS.map((plan) => (
                <td
                  key={plan.id}
                  className={`px-4 py-2.5 text-center text-[13px] ${plan.highlighted ? "bg-indigo-500/5 text-zinc-100" : "text-zinc-400"}`}
                >
                  {row.values[plan.id]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
