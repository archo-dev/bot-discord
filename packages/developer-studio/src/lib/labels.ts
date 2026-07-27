import type { EntitlementLifecycleState, EntitlementOriginKind } from "@bot/shared";

/** FR label for the clarified origin. Lifetime granted reads « Lifetime offert ». */
export function originKindLabel(kind: EntitlementOriginKind, isLifetime = false): string {
  if (isLifetime && kind === "granted") return "Lifetime offert";
  switch (kind) {
    case "paid": return "Abonnement";
    case "granted": return "Accès offert";
    case "early_access": return "Accès bêta";
    case "trial": return "Essai";
    case "promotion": return "Promotion";
    case "partner": return "Partenaire";
    default: return kind;
  }
}

/** FR label for the derived lifecycle state. */
export function lifecycleStateLabel(state: EntitlementLifecycleState): string {
  switch (state) {
    case "scheduled": return "Programmé";
    case "active": return "Actif";
    case "expired": return "Expiré";
    case "revoked": return "Révoqué";
    case "suspended": return "Suspendu";
    case "cancelled": return "Annulé";
    case "past_due": return "Paiement en retard";
    default: return state;
  }
}

/** FR label for an audit action key (e.g. « subscriptions.grant_lifetime »).
 * Falls back to the raw key only when unmapped — kept readable, never a stack. */
export function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    "subscriptions.grant": "Octroi d'un accès",
    "subscriptions.grant_lifetime": "Octroi d'un accès à vie",
    "subscriptions.revoke_granted": "Révocation d'un accès offert",
    "subscriptions.cancel_paid": "Annulation d'un abonnement",
    "subscriptions.refund_paid": "Remboursement d'un abonnement",
    "support.manage": "Action support",
    "guilds.inspect": "Inspection d'une guilde",
    "features.manage": "Modification d'un flag",
    "updates.publish": "Publication d'une mise à jour",
    "deployments.read": "Lecture des déploiements",
    "deployments.manage": "Gestion d'un déploiement",
    "audit.read": "Consultation de l'audit",
  };
  return map[action] ?? action;
}

/** FR label for an audit actor (« operator:123 » → « Opérateur », « system » → « Système »). */
export function auditActorLabel(actor: string): string {
  if (actor === "system") return "Système";
  if (actor.startsWith("operator:")) return "Opérateur";
  return actor;
}

/** Short date (YYYY-MM-DD) from an ISO string; « — » when null. */
export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
