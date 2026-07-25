/*
 * Service CENTRAL d'enforcement des plans (Worker). Unique point qui : résout le
 * plan effectif d'une guilde, évalue une capability via la policy @bot/shared, et
 * enregistre la décision shadow (dimensions bornées, aucune PII). Toute route,
 * commande ou garde interne passe par ici — jamais de règle de plan en dur.
 *
 * En mode "off" : aucune résolution, aucune métrique (état prod inchangé).
 */

import {
  entitlementLifecycleState,
  evaluateCapability,
  type CapabilityDecision,
  type CapabilityEnforcementMode,
  type CapabilityId,
  type CapabilityReason,
  type CapabilitySurface,
  type PlanId,
} from "@bot/shared";
import type { Env } from "../env.js";
import { getEnforcementMode, getWorkerFlags } from "../config/flags.js";
import { resolveGuildPlan } from "../api/assignments.js";
import { getGuildEntitlementRow, rowToEntitlementInput } from "../db/queries.js";
import { incrementCapabilityMetric } from "../db/queries.js";

/** Plan effectif d'une guilde + raison précise si Free (pour la métrique/refus). */
export interface GuildCapabilityContext {
  effectivePlan: PlanId;
  /** Pourquoi la guilde est Free ; `null` si Premium/Business (accès accordé). */
  freeReason: CapabilityReason | null;
}

/**
 * Résout le plan effectif d'une GUILDE (jamais du client) et, si Free, la raison :
 *   - guilde non affectée / assignment libéré → assignment_required
 *   - entitlement expiré/révoqué/programmé → reason dédiée
 *   - entitlement suspendu/annulé/impayé → no_active_entitlement
 *   - entitlement actif mais slot au-delà de la capacité → assignment_required
 * Une guilde non assignée reste Free même si son propriétaire possède Business.
 */
export async function resolveGuildCapabilityContext(
  db: D1Database,
  guildId: string,
  entitlementsEnabled: boolean,
  now: Date,
): Promise<GuildCapabilityContext> {
  if (!entitlementsEnabled) return { effectivePlan: "free", freeReason: "no_active_entitlement" };

  const plan = await resolveGuildPlan(db, guildId, now, true);
  if (plan.id !== "free") return { effectivePlan: plan.id, freeReason: null };

  // Free : déterminer la raison exacte à partir de l'entitlement backing (si présent).
  const entRow = await getGuildEntitlementRow(db, guildId);
  if (!entRow) return { effectivePlan: "free", freeReason: "assignment_required" };
  const state = entitlementLifecycleState(rowToEntitlementInput(entRow), now);
  switch (state) {
    case "expired": return { effectivePlan: "free", freeReason: "entitlement_expired" };
    case "revoked": return { effectivePlan: "free", freeReason: "entitlement_revoked" };
    case "scheduled": return { effectivePlan: "free", freeReason: "entitlement_scheduled" };
    case "active": return { effectivePlan: "free", freeReason: "assignment_required" }; // slot hors capacité
    default: return { effectivePlan: "free", freeReason: "no_active_entitlement" };
  }
}

export interface CheckCapabilityInput {
  surface: CapabilitySurface;
  guildId: string;
  capability: CapabilityId;
  /** Usage courant pour une capacité quotée (compté au point d'appel). */
  usage?: number | null;
  /** Instant d'évaluation (injectable pour les tests). */
  now?: Date;
  /** Planification best-effort de l'écriture métrique ; sinon awaitée (tests). */
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * Évalue + enregistre une capability. Retourne la décision (allowed=true en
 * off/shadow). En `off` : aucune résolution, aucune métrique. La métrique
 * n'enregistre QUE des dimensions bornées (enums + compteur) — aucune PII.
 */
export async function checkCapability(env: Env, input: CheckCapabilityInput): Promise<CapabilityDecision> {
  const mode: CapabilityEnforcementMode = getEnforcementMode(env);
  const now = input.now ?? new Date();

  if (mode === "off") {
    return evaluateCapability({ capability: input.capability, effectivePlan: "free", mode: "off", usage: input.usage });
  }

  const entitlementsEnabled = getWorkerFlags(env)["platform.entitlements"];
  const ctx = await resolveGuildCapabilityContext(env.DB, input.guildId, entitlementsEnabled, now);
  const decision = evaluateCapability({
    capability: input.capability,
    effectivePlan: ctx.effectivePlan,
    mode,
    usage: input.usage,
    freeReason: ctx.freeReason,
  });

  // Toute décision (allowed OU would_block) est comptée : on mesure l'usage réel.
  const record = incrementCapabilityMetric(env.DB, {
    surface: input.surface,
    capability: decision.capability,
    effectivePlan: decision.effectivePlan,
    requiredPlan: decision.requiredPlan,
    reason: decision.reason,
    decision: decision.wouldBlock ? "would_block" : "allowed",
  }).catch(() => undefined);
  if (input.waitUntil) input.waitUntil(record);
  else await record;

  return decision;
}
