/*
 * Helpers PURS d'affichage de l'enforcement des plans (display-only). La décision
 * fait AUTORITÉ côté serveur (Worker/Gateway) : ces helpers ne font que présenter
 * le plan requis / le quota. Aucune décision d'accès n'est prise ici, aucun plan
 * n'est jamais envoyé par le frontend. Prêt à être branché quand `enforce` arrive.
 */
import {
  PLAN_CAPABILITY_POLICY,
  capabilityDenialMessageFr,
  type CapabilityDecision,
  type CapabilityId,
  type PlanId,
} from "@bot/shared";

const PLAN_LABEL: Readonly<Record<PlanId, string>> = {
  free: "Free",
  premium: "Premium",
  business: "Business",
};

/** Plan minimum requis pour une capacité (badge « Premium requis »). */
export function requiredPlanFor(capability: CapabilityId): PlanId {
  return PLAN_CAPABILITY_POLICY[capability].requiredPlan;
}

/** Libellé de badge « {Plan} requis », ou `null` si la capacité est Free. */
export function planBadgeLabel(capability: CapabilityId): string | null {
  const plan = requiredPlanFor(capability);
  return plan === "free" ? null : `${PLAN_LABEL[plan]} requis`;
}

/** Plafond du plan effectif pour une capacité quotée (`null` si non quotée). */
export function quotaFor(capability: CapabilityId, plan: PlanId): number | null {
  return PLAN_CAPABILITY_POLICY[capability].quota?.[plan] ?? null;
}

/** Texte « usage / quota » pour une capacité quotée. */
export function quotaUsageLabel(capability: CapabilityId, plan: PlanId, usage: number): string | null {
  const quota = quotaFor(capability, plan);
  return quota === null ? null : `${usage}/${quota}`;
}

/**
 * Message utilisateur pour un refus (réutilise la formulation serveur). Billing
 * OFF : aucune proposition de paiement — l'accès Premium est « accordé par
 * Archolabs ».
 */
export function denialMessage(decision: CapabilityDecision): string {
  return capabilityDenialMessageFr(decision);
}

/** Note affichée quand billing est OFF (aucun checkout proposé). */
export const BILLING_OFF_ACCESS_NOTE =
  "Cette fonctionnalité nécessite un accès Premium accordé par Archolabs.";
