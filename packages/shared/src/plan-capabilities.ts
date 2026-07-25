/*
 * Catalogue CENTRAL des capacités par plan (chantier « entitlement-lifecycle »).
 *
 * Portée volontairement limitée : on CENTRALISE et on EXPOSE EN LECTURE les
 * capacités, SANS aucun enforcement. Seul `guildSlots` a une valeur produit
 * validée (1/3/5, aligné sur PLANS.slots) ; toute autre capacité est marquée
 * `pendingProductDecision` — on ne fixe pas de valeurs définitives ni ne bloque
 * la moindre fonctionnalité existante. Le futur mode shadow/enforcement est
 * préparé (type ci-dessous) mais reste OFF. Voir docs/platform-split/06.
 */

import { PLANS, type PlanId } from "./entitlement.js";

/** Sentinelle : la valeur/plafond de cette capacité reste une décision produit. */
export const PENDING_PRODUCT_DECISION = "pendingProductDecision" as const;
export type PendingProductDecision = typeof PENDING_PRODUCT_DECISION;

/** Une capacité chiffrée non encore tranchée, ou un plafond validé. */
export type CapacityLimit = number | PendingProductDecision;
/** Une capacité booléenne non encore tranchée, ou un accès validé. */
export type CapacityFlag = boolean | PendingProductDecision;

/**
 * Capacités d'un plan. `guildSlots` est la seule dont la valeur est active
 * (dérivée de PLANS). Les autres sont des emplacements typés, explicitement
 * `pendingProductDecision` : ni valeur définitive, ni blocage.
 */
export interface PlanCapabilities {
  /** Emplacements de serveurs affectables — SEULE limite réellement active. */
  guildSlots: number;
  /** Nombre de commandes personnalisées. */
  customCommands: CapacityLimit;
  /** Automations actives simultanées. */
  automationsActive: CapacityLimit;
  /** Rétention des logs vocaux (jours). */
  voiceLogRetentionDays: CapacityLimit;
  /** Auto-modération IA contextuelle. */
  aiModeration: CapacityFlag;
  /** Priorité de support (indicatif, non contractuel). */
  supportPriority: "community" | "standard" | "priority" | PendingProductDecision;
}

/**
 * Catalogue canonique. `guildSlots` reflète PLANS.slots (source de vérité unique) ;
 * tout le reste est `pendingProductDecision` tant que le produit n'a pas tranché.
 */
export const PLAN_CAPABILITIES: Readonly<Record<PlanId, PlanCapabilities>> = {
  free: {
    guildSlots: PLANS.free.slots,
    customCommands: PENDING_PRODUCT_DECISION,
    automationsActive: PENDING_PRODUCT_DECISION,
    voiceLogRetentionDays: PENDING_PRODUCT_DECISION,
    aiModeration: PENDING_PRODUCT_DECISION,
    supportPriority: PENDING_PRODUCT_DECISION,
  },
  premium: {
    guildSlots: PLANS.premium.slots,
    customCommands: PENDING_PRODUCT_DECISION,
    automationsActive: PENDING_PRODUCT_DECISION,
    voiceLogRetentionDays: PENDING_PRODUCT_DECISION,
    aiModeration: PENDING_PRODUCT_DECISION,
    supportPriority: PENDING_PRODUCT_DECISION,
  },
  business: {
    guildSlots: PLANS.business.slots,
    customCommands: PENDING_PRODUCT_DECISION,
    automationsActive: PENDING_PRODUCT_DECISION,
    voiceLogRetentionDays: PENDING_PRODUCT_DECISION,
    aiModeration: PENDING_PRODUCT_DECISION,
    supportPriority: PENDING_PRODUCT_DECISION,
  },
};

/**
 * Mode d'application des capacités. Préparé pour un futur déploiement progressif ;
 * **toujours `off`** dans ce chantier (aucun blocage, `FEATURE_ACCESS_MODE` inchangé).
 *   off     : aucune vérification (état actuel).
 *   shadow  : on mesure les dépassements SANS bloquer (observation).
 *   enforce : on applique les plafonds (jamais activé ici).
 */
export type CapabilityEnforcementMode = "off" | "shadow" | "enforce";
export const CAPABILITY_ENFORCEMENT_MODE: CapabilityEnforcementMode = "off";

/** Réponse lecture seule du catalogue (GET /api/capabilities). Aucune donnée de paiement. */
export interface CapabilitiesResponse {
  plans: Record<PlanId, PlanCapabilities>;
  enforcementMode: CapabilityEnforcementMode;
}

/** Vue lecture seule du catalogue + mode courant (pur). */
export function getCapabilitiesResponse(): CapabilitiesResponse {
  return { plans: PLAN_CAPABILITIES, enforcementMode: CAPABILITY_ENFORCEMENT_MODE };
}
