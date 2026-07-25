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

/**
 * Marqueur structuré (dans `entitlements.origin_ref`) d'un accès offert « bêta ».
 * Décision produit (early access = OPTION A) : PAS de nouvelle valeur d'enum D1 —
 * on réutilise `source='granted'` et on discrimine l'origine bêta par ce jeton
 * stable dans `origin_ref`. Un grant standard garde `origin_ref = <grantId>`.
 * Ne jamais dépendre d'une note libre pour déterminer la source (doc 06, OPTION A).
 */
export const EARLY_ACCESS_ORIGIN_REF = "early_access" as const;

/**
 * Origine « claire » présentée aux surfaces (Studio/panel). Dérivée côté serveur,
 * jamais stockée : `granted` + `origin_ref='early_access'` → `early_access`.
 * Le caractère lifetime est orthogonal (`is_lifetime`), pas une origine distincte.
 */
export type EntitlementOriginKind =
  | "paid"
  | "granted"
  | "early_access"
  | "trial"
  | "promotion"
  | "partner";

/** Résout l'origine claire d'un entitlement (pure, déterministe). */
export function resolveOriginKind(
  source: EntitlementSource,
  originRef: string | null,
): EntitlementOriginKind {
  if (source === "granted" && originRef === EARLY_ACCESS_ORIGIN_REF) return "early_access";
  return source;
}

/** États d'un entitlement (machine d'états, doc 06). */
export type EntitlementStatus =
  | "active"
  | "expired"
  | "revoked"
  | "cancelled"
  | "suspended"
  | "past_due";

/**
 * État de cycle de vie *effectif* d'un entitlement, dérivé du statut stocké ET de
 * la fenêtre temporelle. `scheduled` (début futur) et `expired` (fin dépassée) ne
 * sont JAMAIS stockés : ils sont dérivés ici pour rester cohérents avant même que
 * le sweep n'ait mis à jour la ligne. Fonction centrale unique — toute route
 * (résolution du plan, listes Studio, compteurs, assignments, API client,
 * métriques) doit passer par elle, jamais réimplémenter sa propre logique.
 */
export type EntitlementLifecycleState =
  | "scheduled"
  | "active"
  | "expired"
  | "revoked"
  | "suspended"
  | "cancelled"
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
  /** Référence d'origine (`origin_ref`) — discrimine notamment l'accès bêta. */
  originRef: string | null;
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
  /** Origine claire dérivée (early_access inclus) ; `null` = Gratuit implicite. */
  originKind: EntitlementOriginKind | null;
  status: EntitlementStatus | null;
  isLifetime: boolean;
  /** ISO 8601 — début de la fenêtre effective (null = Gratuit implicite). */
  startAt: string | null;
  endAt: string | null;
}

/** Gratuit implicite — aucun stockage requis. */
export const EFFECTIVE_FREE: EffectiveEntitlement = {
  planId: PLAN_FREE.id,
  planRank: PLAN_FREE.rank,
  slots: PLAN_FREE.slots,
  displayName: PLAN_FREE.displayName,
  source: null,
  originKind: null,
  status: null,
  isLifetime: false,
  startAt: null,
  endAt: null,
};

function toTime(iso: string): number {
  return Date.parse(iso);
}

/**
 * État de cycle de vie effectif (central, pur). Les statuts terminaux/explicites
 * stockés priment ; pour un `active`, on dérive `scheduled` (début futur) /
 * `expired` (fin dépassée). Un `active` non-lifetime sans `end_at` est INVALIDE
 * selon le schéma (CHECK D1) — traité défensivement comme `expired` (non effectif).
 */
export function entitlementLifecycleState(
  e: EntitlementInput,
  now: Date | string | number,
): EntitlementLifecycleState {
  if (e.status === "revoked") return "revoked";
  if (e.status === "suspended") return "suspended";
  if (e.status === "cancelled") return "cancelled";
  if (e.status === "past_due") return "past_due";
  if (e.status === "expired") return "expired";
  // status === "active" : dériver de la fenêtre.
  const nowMs = toNowMs(now);
  const start = toTime(e.startAt);
  if (Number.isNaN(start)) return "expired"; // date illisible → non effectif (défensif)
  if (start > nowMs) return "scheduled";
  if (e.isLifetime) return "active";
  if (e.endAt === null) return "expired"; // non-lifetime sans fin = invalide (CHECK)
  const end = toTime(e.endAt);
  if (Number.isNaN(end) || end <= nowMs) return "expired";
  return "active";
}

/** Un entitlement est-il *effectif* (= état de cycle de vie `active`) à `now` ? */
export function isEffectiveEntitlement(e: EntitlementInput, now: Date | string | number): boolean {
  return entitlementLifecycleState(e, now) === "active";
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

function toNowMs(now: Date | string | number): number {
  return now instanceof Date ? now.getTime() : typeof now === "number" ? now : toTime(now);
}

/**
 * Index du meilleur entitlement actif (ou -1 si aucun → Gratuit implicite).
 * Pur/déterministe — permet au backend de retrouver la ligne source (son id).
 */
export function pickBestEntitlementIndex(
  entitlements: readonly EntitlementInput[],
  now: Date | string | number,
): number {
  let bestIdx = -1;
  for (let i = 0; i < entitlements.length; i++) {
    const e = entitlements[i]!;
    if (!isEffectiveEntitlement(e, now)) continue;
    if (bestIdx === -1 || compareEntitlements(e, entitlements[bestIdx]!) > 0) bestIdx = i;
  }
  return bestIdx;
}

/**
 * Résout le **meilleur entitlement actif** d'un utilisateur à l'instant `now`.
 * Pure et déterministe (mêmes entrées → même sortie). Aucun candidat → Gratuit.
 */
export function resolveEffectiveEntitlement(
  entitlements: readonly EntitlementInput[],
  now: Date | string | number,
): EffectiveEntitlement {
  const bestIdx = pickBestEntitlementIndex(entitlements, now);
  if (bestIdx === -1) return EFFECTIVE_FREE;
  const best = entitlements[bestIdx]!;
  const plan = PLANS[best.planId];
  return {
    planId: plan.id,
    planRank: plan.rank,
    slots: plan.slots,
    displayName: plan.displayName,
    source: best.source,
    originKind: resolveOriginKind(best.source, best.originRef),
    status: best.status,
    isLifetime: best.isLifetime,
    startAt: best.startAt,
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
