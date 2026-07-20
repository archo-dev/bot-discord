/*
 * Modèle d'entitlements — logique métier PURE des droits d'accès (M6).
 * Frontière partagée worker/panel : le **plan effectif** et la **révocabilité**
 * se calculent ici, de façon déterministe, jamais côté client. Séparé du RBAC
 * de modules (`CapabilityEntitlement`, modules.ts) — concept distinct.
 * Voir docs/platform-split/06-subscriptions-and-entitlements.md (§résolution).
 */

/** Identifiants techniques stables des offres (cf. README platform-split §4). */
export type PlanId = "free" | "premium" | "business";

export interface PlanDef {
  readonly id: PlanId;
  /** free=1 < premium=2 < business=3. */
  readonly rank: number;
  /** Emplacements de serveurs : 1 / 3 / 5. */
  readonly slots: number;
  readonly displayName: string;
}

/** Catalogue canonique (source de vérité applicative ; la table D1 `plans` la reflète). */
export const PLANS: Readonly<Record<PlanId, PlanDef>> = {
  free: { id: "free", rank: 1, slots: 1, displayName: "Gratuit" },
  premium: { id: "premium", rank: 2, slots: 3, displayName: "Premium" },
  business: { id: "business", rank: 3, slots: 5, displayName: "Business" },
};

export const PLAN_FREE: PlanDef = PLANS.free;

/** Origine d'un entitlement — détermine la révocabilité. */
export type EntitlementSource = "paid" | "granted" | "trial" | "promotion" | "partner";

/** États d'un entitlement (machine d'états, doc 06). */
export type EntitlementStatus =
  | "active"
  | "expired"
  | "revoked"
  | "cancelled"
  | "suspended"
  | "past_due";

/** Départage déterministe à rang de plan égal : paid > granted > partner > promotion > trial. */
const SOURCE_PRIORITY: Readonly<Record<EntitlementSource, number>> = {
  paid: 5,
  granted: 4,
  partner: 3,
  promotion: 2,
  trial: 1,
};

/** Entrée minimale pour la résolution (pure — aucune dépendance D1). */
export interface EntitlementInput {
  planId: PlanId;
  source: EntitlementSource;
  status: EntitlementStatus;
  /** ISO 8601. */
  startAt: string;
  /** ISO 8601, ou `null` si lifetime. */
  endAt: string | null;
  isLifetime: boolean;
  /** ISO 8601 — dernier départage (le plus récent gagne). */
  createdAt: string;
}

/** Plan effectif résolu d'un utilisateur. `source=null` = Gratuit implicite. */
export interface EffectiveEntitlement {
  planId: PlanId;
  planRank: number;
  slots: number;
  displayName: string;
  source: EntitlementSource | null;
  status: EntitlementStatus | null;
  isLifetime: boolean;
  endAt: string | null;
}

/** Gratuit implicite — aucun stockage requis. */
export const EFFECTIVE_FREE: EffectiveEntitlement = {
  planId: PLAN_FREE.id,
  planRank: PLAN_FREE.rank,
  slots: PLAN_FREE.slots,
  displayName: PLAN_FREE.displayName,
  source: null,
  status: null,
  isLifetime: false,
  endAt: null,
};

function toTime(iso: string): number {
  return Date.parse(iso);
}

/** Un entitlement est-il un candidat actif à `nowMs` ? (status active, dans la fenêtre). */
function isActiveCandidate(e: EntitlementInput, nowMs: number): boolean {
  if (e.status !== "active") return false;
  const start = toTime(e.startAt);
  if (Number.isNaN(start) || start > nowMs) return false;
  if (e.isLifetime) return true;
  if (e.endAt === null) return false; // non-lifetime doit avoir une fin
  const end = toTime(e.endAt);
  return !Number.isNaN(end) && end > nowMs;
}

/** Compare deux candidats. >0 si `a` prime sur `b`. Déterministe. */
function compareEntitlements(a: EntitlementInput, b: EntitlementInput): number {
  const rankDelta = PLANS[a.planId].rank - PLANS[b.planId].rank;
  if (rankDelta !== 0) return rankDelta;

  const lifeDelta = (a.isLifetime ? 1 : 0) - (b.isLifetime ? 1 : 0);
  if (lifeDelta !== 0) return lifeDelta;

  // Portée la plus longue (lifetime = +inf, déjà départagé au-dessus).
  const endA = a.endAt === null ? Infinity : toTime(a.endAt);
  const endB = b.endAt === null ? Infinity : toTime(b.endAt);
  if (endA !== endB) return endA - endB;

  const prioDelta = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
  if (prioDelta !== 0) return prioDelta;

  // Dernier recours : le plus récent.
  return toTime(a.createdAt) - toTime(b.createdAt);
}

/**
 * Résout le **meilleur entitlement actif** d'un utilisateur à l'instant `now`.
 * Pure et déterministe (mêmes entrées → même sortie). Aucun candidat → Gratuit.
 */
export function resolveEffectiveEntitlement(
  entitlements: readonly EntitlementInput[],
  now: Date | string | number,
): EffectiveEntitlement {
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : toTime(now);
  let best: EntitlementInput | null = null;
  for (const e of entitlements) {
    if (!isActiveCandidate(e, nowMs)) continue;
    if (best === null || compareEntitlements(e, best) > 0) best = e;
  }
  if (best === null) return EFFECTIVE_FREE;
  const plan = PLANS[best.planId];
  return {
    planId: plan.id,
    planRank: plan.rank,
    slots: plan.slots,
    displayName: plan.displayName,
    source: best.source,
    status: best.status,
    isLifetime: best.isLifetime,
    endAt: best.endAt,
  };
}

// --- Révocabilité & machine d'états (invariants doc 08) ---

/** Invariant 2 : la révocabilité dérive de l'origine, jamais stockée. */
export function isRevocable(source: EntitlementSource): boolean {
  return source !== "paid";
}

/** Transitions autorisées de la machine d'états (doc 06). */
const TRANSITIONS: Readonly<Record<EntitlementStatus, readonly EntitlementStatus[]>> = {
  active: ["past_due", "cancelled", "suspended", "expired", "revoked"],
  past_due: ["active", "expired"],
  cancelled: ["expired"],
  suspended: ["active", "expired", "revoked"],
  expired: [],
  revoked: [],
};

/**
 * Une transition d'état est-elle permise pour cette origine ?
 * Garde dure : un `paid` ne passe **jamais** par `revoked` (invariant 6).
 */
export function canTransition(
  from: EntitlementStatus,
  to: EntitlementStatus,
  source: EntitlementSource,
): boolean {
  if (from === to) return false;
  if (to === "revoked" && source === "paid") return false;
  return TRANSITIONS[from].includes(to);
}
