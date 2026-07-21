/*
 * Helpers PURS de l'espace abonnement/compte (M8) — aucune dépendance React/DOM,
 * testables en node. La vérité (plan effectif, emplacements) vient du backend
 * (GET /api/subscription[/assignments], /api/account) ; ces helpers formatent.
 */
import type { EntitlementSource } from "@bot/shared";

/** Libellé FR de l'origine d'un entitlement (`null` = Gratuit par défaut). */
export function entitlementSourceLabel(source: EntitlementSource | null): string {
  switch (source) {
    case "paid":
      return "Abonnement payant";
    case "granted":
      return "Accès offert";
    case "trial":
      return "Essai";
    case "promotion":
      return "Promotion";
    case "partner":
      return "Partenariat";
    default:
      return "Offre gratuite";
  }
}

/** Date + heure en français (session, fin de période). Robuste. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Nombre d'affectations suspendues (excédentaires) dans une réponse d'emplacements. */
export function countSuspended(assignments: readonly { state: "active" | "suspended" }[]): number {
  return assignments.filter((a) => a.state === "suspended").length;
}
