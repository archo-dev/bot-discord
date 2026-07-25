/*
 * DTOs de l'enforcement des plans (chantier « plan-capability-enforcement »).
 *   - GET /api/capabilities        : catalogue + policy + mode (lecture, panel).
 *   - GET /studio-api/capability-shadow : vue opérateur agrégée (no PII).
 *   - POST /internal/capability-metrics : batch Gateway → Worker (dims bornées).
 * Aucune donnée de paiement, aucun userId/guildId brut nulle part.
 */

import type {
  CapabilityEnforcementMode,
  CapabilityId,
  CapabilityReason,
  CapabilitySurface,
  PlanCapabilityPolicy,
} from "../capability-policy.js";
import type { PlanCapabilities } from "../plan-capabilities.js";
import type { PlanId } from "../entitlement.js";

/** GET /api/capabilities — catalogue lecture seule + policy + mode courant. */
export interface CapabilityPolicyResponse {
  enforcementMode: CapabilityEnforcementMode;
  /** Capacités chiffrées par plan (guildSlots réel, reste indicatif). */
  plans: Record<PlanId, PlanCapabilities>;
  /** Policy centrale : plan requis + plafonds par capability. */
  policy: Record<CapabilityId, PlanCapabilityPolicy>;
}

/**
 * Un enregistrement de métrique shadow AGRÉGÉ. Toutes les dimensions sont
 * bornées (enums + compteurs) : jamais de userId/guildId/nom/contenu/secret.
 */
export interface CapabilityShadowRow {
  surface: CapabilitySurface;
  capability: CapabilityId;
  effectivePlan: PlanId;
  requiredPlan: PlanId;
  reason: CapabilityReason;
  decision: "allowed" | "would_block";
  count: number;
}

/** GET /studio-api/capability-shadow — vue opérateur agrégée. */
export interface CapabilityShadowResponse {
  windowHours: number;
  enforcementMode: CapabilityEnforcementMode;
  totalCalls: number;
  allowed: number;
  wouldBlock: number;
  /** Taux d'impact = wouldBlock / totalCalls (0 si aucun appel). */
  impactRate: number;
  /** Détail par capability (trié par wouldBlock décroissant). */
  byCapability: {
    capability: CapabilityId;
    total: number;
    wouldBlock: number;
    topReason: CapabilityReason | null;
  }[];
  /** Détail par plan effectif. */
  byPlan: { effectivePlan: PlanId; total: number; wouldBlock: number }[];
  /** Détail par raison dominante. */
  byReason: { reason: CapabilityReason; count: number }[];
  /** Lignes brutes agrégées (bornées). */
  rows: CapabilityShadowRow[];
}

/** Un item d'un batch de décisions shadow rapportées par la Gateway. */
export interface CapabilityMetricBatchItem {
  surface: CapabilitySurface;
  capability: CapabilityId;
  effectivePlan: PlanId;
  requiredPlan: PlanId;
  reason: CapabilityReason;
  decision: "allowed" | "would_block";
  /** Nombre d'occurrences agrégées côté Gateway (≥ 1). */
  count: number;
}

/** POST /internal/capability-metrics — batch borné (Gateway → Worker). */
export interface CapabilityMetricBatch {
  items: CapabilityMetricBatchItem[];
}
