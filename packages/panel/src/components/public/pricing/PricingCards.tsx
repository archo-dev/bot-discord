import { useEffect, useState } from "react";
import type { LaunchPricing, PlanPricing, PricingResponse } from "@bot/shared";
import { PLAN_TIERS, serversLabel } from "../../../lib/plans.js";
import { Button } from "../../../ui/kit.js";
import { Icon } from "../../../ui/icons.js";
import { billingPeriodNote, type BillingPeriod } from "./data.js";

/* Cartes d'offres (M4 + M16). Les montants viennent EXCLUSIVEMENT de la config
   backend (`GET /api/pricing`, décision D1) — aucun prix en dur. Tant que
   `platform.launch` est off ou la config incomplète : « Tarifs à venir ». */

function formatAmount(smallestUnit: number, currency: string, period: BillingPeriod): string {
  const amount = smallestUnit / 100;
  const formatted = new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  return `${formatted}${period === "monthly" ? " /mois" : " /an"}`;
}

function planAmount(pricing: LaunchPricing, planId: string, period: BillingPeriod): string | null {
  const tier: PlanPricing | null = planId === "premium" ? pricing.premium : planId === "business" ? pricing.business : null;
  if (!tier) return null;
  return formatAmount(period === "monthly" ? tier.monthly : tier.yearly, pricing.currency, period);
}

export function PricingCards({ period }: { period: BillingPeriod }) {
  const [pricing, setPricing] = useState<LaunchPricing | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/pricing", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<PricingResponse>) : null))
      .then((body) => {
        if (alive && body) setPricing(body.pricing);
      })
      .catch(() => {
        /* Réseau indisponible → fallback « Tarifs à venir ». */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {PLAN_TIERS.map((plan) => {
        const price = plan.id === "free" ? "Gratuit" : pricing ? planAmount(pricing, plan.id, period) : null;
        return (
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
              <span className="text-2xl font-semibold text-zinc-100">{price ?? "Tarifs à venir"}</span>
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
        );
      })}
    </div>
  );
}
