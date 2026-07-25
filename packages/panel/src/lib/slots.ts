/*
 * Helpers PURS d'affichage des emplacements (M7) — aucune dépendance React/DOM,
 * testables en node. La vérité (slots, used, état) vient du backend
 * (GET /api/subscription/assignments) ; ces helpers ne font que formater.
 */
import type { AssignmentState, PlanId, SlotAssignment } from "@bot/shared";

/** Emplacements libres (jamais négatif). */
export function availableSlots(used: number, total: number): number {
  return Math.max(0, Math.floor(total) - Math.floor(used));
}

/** Libellé « N / M emplacements ». */
export function slotSummaryLabel(used: number, total: number): string {
  const u = Math.max(0, Math.floor(used));
  const t = Math.max(0, Math.floor(total));
  return `${u} / ${t} emplacement${t > 1 ? "s" : ""}`;
}

/** Libellé FR d'un état d'affectation. */
export function assignmentStateLabel(state: AssignmentState): string {
  return state === "active" ? "Actif" : "Suspendu";
}

/** Nom d'affichage d'une offre (pour l'incitation LockedFeature). */
export function planDisplayName(planId: PlanId): string {
  return planId === "business" ? "Business" : planId === "premium" ? "Premium" : "Gratuit";
}

/** Un serveur affecté à un emplacement (nom résolu via /api/guilds si connu). */
export interface AssignedGuild {
  guildId: string;
  /** Nom du serveur, ou `null` si non résolvable (bot retiré, droits perdus…). */
  name: string | null;
  state: AssignmentState;
}

/** Un serveur connecté & administrable, éligible mais pas encore affecté. */
export interface AssignableGuild {
  guildId: string;
  name: string;
}

/**
 * Vue composée de la section « Emplacements de serveurs ». Croise les emplacements
 * résolus backend (`/api/subscription/assignments`, seule source de vérité pour le
 * compteur used/total) avec les serveurs connectés & administrables
 * (`/api/guilds`, seule source des noms et de l'éligibilité — déjà filtrée sur
 * bot_installed=1). Pure : aucune mutation, aucun accès réseau.
 */
export interface SlotComposition {
  /** Emplacements réellement consommés (assignations actives). */
  used: number;
  /** Capacité du plan effectif. */
  total: number;
  /** Assignations excédentaires (au-delà de la capacité), conservées mais inertes. */
  suspended: number;
  /** Serveurs affectés (actifs puis suspendus), nom résolu quand connu. */
  assigned: AssignedGuild[];
  /** Serveurs connectés éligibles, non encore affectés (candidats à « Affecter »). */
  available: AssignableGuild[];
}

/**
 * Compose la vue des emplacements. `assignments` porte le compteur canonique
 * (used/slots, déjà expurgé des released/expirés/programmés côté backend) ; on
 * n'ajoute JAMAIS un serveur au compteur ici. `guilds` ne sert qu'à nommer les
 * serveurs affectés et à lister les serveurs éligibles restants (bot présent).
 */
export function composeSlots(
  assignments: { slots: number; used: number; assignments: readonly SlotAssignment[] },
  guilds: readonly { id: string; name: string }[],
): SlotComposition {
  const nameById = new Map(guilds.map((g) => [g.id, g.name] as const));
  const assignedIds = new Set(assignments.assignments.map((a) => a.guildId));

  // Actifs d'abord (ils consomment un emplacement), puis suspendus.
  const assigned: AssignedGuild[] = [...assignments.assignments]
    .sort((a, b) => (a.state === b.state ? 0 : a.state === "active" ? -1 : 1))
    .map((a) => ({ guildId: a.guildId, name: nameById.get(a.guildId) ?? null, state: a.state }));

  // Éligibles = connectés & administrables, pas déjà affectés.
  const available: AssignableGuild[] = guilds
    .filter((g) => !assignedIds.has(g.id))
    .map((g) => ({ guildId: g.id, name: g.name }));

  return {
    used: assignments.used,
    total: assignments.slots,
    suspended: assignments.assignments.filter((a) => a.state === "suspended").length,
    assigned,
    available,
  };
}
