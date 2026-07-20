/*
 * Helpers PURS d'affichage des emplacements (M7) — aucune dépendance React/DOM,
 * testables en node. La vérité (slots, used, état) vient du backend
 * (GET /api/subscription/assignments) ; ces helpers ne font que formater.
 */
import type { AssignmentState, PlanId } from "@bot/shared";

/** Emplacements libres (jamais négatif). */
export function availableSlots(used: number, total: number): number {
  return Math.max(0, Math.floor(total) - Math.floor(used));
}

/** Libellé « N / M emplacements ». */
export function slotSummaryLabel(used: number, total: number): string {
  const u = Math.max(0, Math.floor(used));
  const t = Math.max(0, Math.floor(total));
  return `${u} / ${t} emplacement${t > 1 ? "s" : ""}`;
}

/** Libellé FR d'un état d'affectation. */
export function assignmentStateLabel(state: AssignmentState): string {
  return state === "active" ? "Actif" : "Suspendu";
}

/** Nom d'affichage d'une offre (pour l'incitation LockedFeature). */
export function planDisplayName(planId: PlanId): string {
  return planId === "business" ? "Business" : planId === "premium" ? "Premium" : "Gratuit";
}
