/*
 * Helpers PURS de l'espace abonnement/compte (M8) — aucune dépendance React/DOM,
 * testables en node. La vérité (plan effectif, emplacements) vient du backend
 * (GET /api/subscription[/assignments], /api/account) ; ces helpers formatent.
 */
import type {
  EntitlementLifecycleState,
  EntitlementOriginKind,
  EntitlementSource,
  FeatureAccessMode,
} from "@bot/shared";

/** Message explaining the backend feature-access policy, when applicable. */
export function featureAccessMessage(mode: FeatureAccessMode): string | null {
  return mode === "early_access"
    ? "Toutes les fonctionnalités client sont débloquées pendant la bêta."
    : null;
}

/**
 * La note globale « accès bêta » ne concerne QUE les comptes sans entitlement
 * explicite : un Business Lifetime offert ne doit jamais être re-libellé
 * « accès anticipé » simplement parce que le mode backend vaut early_access
 * (bug prod M17). Un entitlement plus précis (source ≠ null) prime toujours ;
 * son origine réelle est portée par [[subscriptionSourceLabel]].
 */
export function showGlobalEarlyAccessNote(
  mode: FeatureAccessMode,
  source: EntitlementSource | null,
): boolean {
  return source === null && mode === "early_access";
}

/**
 * Libellé FR unique de l'origine effective présentée sur « Mon abonnement ».
 * Prend en compte le caractère lifetime (orthogonal à l'origine). `null` = Gratuit.
 * Ne mentionne jamais de facture/prix pour un accès offert (accès bêta compris).
 */
export function subscriptionSourceLabel(
  originKind: EntitlementOriginKind | null,
  isLifetime: boolean,
): string {
  switch (originKind) {
    case "early_access":
      return "Accès bêta";
    case "granted":
      return isLifetime ? "Lifetime offert" : "Accès offert";
    case "promotion":
      return "Accès promotionnel";
    case "trial":
      return "Essai";
    case "paid":
      return "Abonnement";
    case "partner":
      return "Partenaire";
    default:
      return "Offre gratuite";
  }
}

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

/**
 * Libellé FR de l'origine « claire » (early_access distingué). `null` = Gratuit.
 * Jamais de mention de facture/prix pour un accès offert (accès bêta compris).
 */
export function originKindLabel(kind: EntitlementOriginKind | null): string {
  switch (kind) {
    case "paid":
      return "Abonnement";
    case "granted":
      return "Accès offert";
    case "early_access":
      return "Accès bêta";
    case "trial":
      return "Essai";
    case "promotion":
      return "Promotion";
    case "partner":
      return "Partenaire";
    default:
      return "Offre gratuite";
  }
}

/** Libellé FR de l'état de cycle de vie effectif (`null` = Gratuit par défaut). */
export function lifecycleStateLabel(state: EntitlementLifecycleState | null): string {
  switch (state) {
    case "scheduled":
      return "Programmé";
    case "active":
      return "Actif";
    case "expired":
      return "Expiré";
    case "revoked":
      return "Révoqué";
    case "suspended":
      return "Suspendu";
    case "cancelled":
      return "Annulé";
    case "past_due":
      return "Paiement en retard";
    default:
      return "Gratuit";
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
