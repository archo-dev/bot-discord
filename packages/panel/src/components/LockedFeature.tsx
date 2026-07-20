import type { ReactNode } from "react";
import { Link } from "react-router";
import type { PlanId } from "@bot/shared";
import { planDisplayName } from "../lib/slots.js";

/*
 * Verrou d'une fonctionnalité réservée à une offre supérieure (M7). N'est
 * JAMAIS l'unique barrière : double une garde backend (le plan effectif est
 * recalculé serveur). Réutilisable par l'écran abonnement / les modules gatés.
 */
export function LockedFeature({
  requiredPlan,
  title = "Fonctionnalité incluse dans une offre supérieure",
  children,
}: {
  requiredPlan: PlanId;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-(--border) bg-zinc-900/40 p-5 text-center">
      <span
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-400"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
      <p className="mt-3 text-sm font-semibold text-zinc-100">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-400">{children}</p>}
      <Link
        to="/pricing"
        className="mt-4 inline-flex items-center rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
      >
        Passer à {planDisplayName(requiredPlan)}
      </Link>
    </div>
  );
}
