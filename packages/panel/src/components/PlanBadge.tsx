import type { PlanId } from "../lib/plans.js";

/* Badge d'offre réutilisable (M4). Présentiel ; réutilisable dans le panel connecté (M8+). */
const PLAN_LABEL: Record<PlanId, string> = { free: "Gratuit", premium: "Premium", business: "Business" };
const PLAN_TONE: Record<PlanId, string> = {
  free: "bg-zinc-800 text-zinc-300",
  premium: "bg-indigo-950 text-indigo-200",
  business: "bg-green-950 text-green-300",
};

export function PlanBadge({ plan, className = "" }: { plan: PlanId; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${PLAN_TONE[plan]} ${className}`}
    >
      {PLAN_LABEL[plan]}
    </span>
  );
}
