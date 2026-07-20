/*
 * Emplacements de serveurs (slots) — logique PURE de réconciliation (M7).
 * L'affectation d'une guilde à un entitlement consomme un slot ; au downgrade,
 * les guildes excédentaires sont **suspendues** (jamais supprimées) et
 * réactivées au ré-upgrade. Déterministe, testable en node.
 * Voir docs/platform-split/06-subscriptions-and-entitlements.md (§emplacements).
 */

/** Cooldown anti « partage tournant » : une guilde retirée n'est réaffectable
 *  qu'après ce délai (D7, défaut). */
export const SLOT_REASSIGN_COOLDOWN_HOURS = 24;

export type AssignmentState = "active" | "suspended";

/** Candidat à la réconciliation (affectation non retirée). */
export interface AssignmentCandidate {
  guildId: string;
  /** Clé de récence ISO (`last_reassigned_at ?? assigned_at`). La plus récente reste active. */
  recencyAt: string;
}

export interface ResolvedSlots {
  /** Guildes qui doivent rester actives (dans la capacité). */
  active: string[];
  /** Guildes excédentaires à suspendre (config conservée). */
  suspended: string[];
}

/**
 * Répartition déterministe active/suspendu pour une capacité de `slots`.
 * Conserve les `slots` affectations les plus récentes actives ; suspend le reste.
 * Départage stable par `guildId` à récence égale. Pur.
 */
export function resolveSlotAssignments(
  candidates: readonly AssignmentCandidate[],
  slots: number,
): ResolvedSlots {
  const sorted = [...candidates].sort((a, b) => {
    const ta = Date.parse(a.recencyAt);
    const tb = Date.parse(b.recencyAt);
    const na = Number.isNaN(ta) ? -Infinity : ta;
    const nb = Number.isNaN(tb) ? -Infinity : tb;
    if (na !== nb) return nb - na; // plus récent d'abord
    return a.guildId < b.guildId ? -1 : a.guildId > b.guildId ? 1 : 0;
  });
  const cap = Math.max(0, Math.floor(slots));
  return {
    active: sorted.slice(0, cap).map((c) => c.guildId),
    suspended: sorted.slice(cap).map((c) => c.guildId),
  };
}
