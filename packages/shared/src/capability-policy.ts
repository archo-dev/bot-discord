/*
 * Source de vérité UNIQUE de l'enforcement des plans (chantier
 * « plan-capability-enforcement »). Toute décision d'accès par plan/quota se
 * calcule ICI, de façon pure et déterministe — jamais dispersée dans une route,
 * une commande ou un module, jamais depuis une valeur envoyée par le frontend.
 *
 * Trois modes (CAPABILITY_ENFORCEMENT_MODE) :
 *   off     : aucune évaluation bloquante, aucune métrique would_block (état prod).
 *   shadow  : on CALCULE la décision réelle et on la compte, mais allowed=true.
 *   enforce : la décision est réellement appliquée (allowed = wouldAllow).
 *
 * Valeurs de quotas = décisions produit VALIDÉES (D-A/D-B/D-C/D-D). Elles ne sont
 * réellement appliquées qu'en mode `enforce` ; en `shadow` elles sont seulement
 * observées. Voir docs/platform-split/06 + le brief d'implémentation.
 */

import { PLANS, type PlanId } from "./entitlement.js";
import type { CapabilityEnforcementMode } from "./plan-capabilities.js";
import type { MusicCommand } from "./api-types/music.js";

export type { CapabilityEnforcementMode } from "./plan-capabilities.js";

/**
 * Parse la variable d'environnement en mode d'enforcement. Toute valeur absente
 * ou invalide retombe sur `off` (fail-safe : jamais de blocage par accident).
 */
export function parseEnforcementMode(value: string | undefined | null): CapabilityEnforcementMode {
  return value === "shadow" || value === "enforce" ? value : "off";
}

/* ------------------------------------------------------------------------- */
/* Catalogue des capacités                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Identifiants techniques STABLES des capacités soumises à l'enforcement.
 * `<domaine>.<action>`. Ne jamais renommer (les métriques agrégées y réfèrent).
 * Les capacités « .use » de base sont Free (aucune régression : tout ce qui
 * marche aujourd'hui reste accessible à tous). La différenciation porte sur les
 * QUOTAS et les sous-capacités avancées.
 */
export const CAPABILITY_IDS = [
  // Accès de base aux modules — Free pour tous (anti-régression).
  "general.config",
  "moderation.use",
  "music.use",
  "custom_commands.use",
  "tickets.use",
  "button_roles.use",
  "welcome.use",
  "automod.use",
  "levels.use",
  "starboard.use",
  "temp_voice.use",
  "voice_logs.use",
  "stats.use",
  "social.use",
  "audit.view",
  "health.view",
  "panel_access.view",
  // Capacités à quota (plafonds validés D-B).
  "slots.assign",
  "custom_commands.create",
  "automations.active",
  "panel_access.delegate",
  // Rétentions (plafonds config, appliqués au balayage — informationnel ici).
  "voice_logs.retention",
  "stats.retention",
  "audit.retention",
  // Débloquées par plan (D-C / matrice).
  "music.advanced",
  "automod.ai",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** Raisons possibles d'une décision (bornées — dimension de métrique). */
export type CapabilityReason =
  | "allowed_by_plan"
  | "plan_required"
  | "quota_exceeded"
  | "no_active_entitlement"
  | "entitlement_scheduled"
  | "entitlement_expired"
  | "entitlement_revoked"
  | "assignment_required"
  | "feature_disabled";

/** Surface d'appel (dimension de métrique bornée). */
export type CapabilitySurface = "interaction" | "api" | "gateway" | "internal";

export const CAPABILITY_SURFACES: readonly CapabilitySurface[] = [
  "interaction",
  "api",
  "gateway",
  "internal",
];

/** Politique d'une capacité : plan minimum + plafonds éventuels par plan. */
export interface PlanCapabilityPolicy {
  /** Plan minimum requis pour l'accès (au niveau « plan »). */
  requiredPlan: PlanId;
  /**
   * Plafond par plan (nombre) — évalué contre `usage`. Absent = capacité non
   * quotée. Une capacité peut être Free au niveau plan MAIS bornée par quota.
   */
  quota?: Readonly<Record<PlanId, number>>;
  /** Documentation courte (jamais affichée à l'utilisateur final). */
  note?: string;
}

/**
 * TABLE POLICY CENTRALE — plafonds = décisions produit validées.
 *   slots           1 / 3 / 5     (D-B, déjà appliqué hors shadow)
 *   custom commands 5 / 25 / 100  (D-B)
 *   automations     2 / 10 / 50   (D-A / D-B)
 *   panel delegates 1 / 3 / 10    (D-B / D-D, hors propriétaire)
 *   voice retention 7 / 30 / 180 jours (D-B, config)
 *   stats retention 7 / 30 / 180 jours (D-B, config)
 *   audit retention 30 / 90 / 365 jours (D-B, config)
 */
export const PLAN_CAPABILITY_POLICY: Readonly<Record<CapabilityId, PlanCapabilityPolicy>> = {
  // --- Accès de base : Free pour tous ---
  "general.config": { requiredPlan: "free" },
  "moderation.use": { requiredPlan: "free" },
  "music.use": { requiredPlan: "free" },
  "custom_commands.use": { requiredPlan: "free" },
  "tickets.use": { requiredPlan: "free" },
  "button_roles.use": { requiredPlan: "free" },
  "welcome.use": { requiredPlan: "free" },
  "automod.use": { requiredPlan: "free" },
  "levels.use": { requiredPlan: "free" },
  "starboard.use": { requiredPlan: "free" },
  "temp_voice.use": { requiredPlan: "free" },
  "voice_logs.use": { requiredPlan: "free" },
  "stats.use": { requiredPlan: "free" },
  "social.use": { requiredPlan: "free" },
  "audit.view": { requiredPlan: "free" },
  "health.view": { requiredPlan: "free" },
  "panel_access.view": { requiredPlan: "free" },

  // --- Quotas (Free au niveau plan, mais plafonnés) ---
  "slots.assign": {
    requiredPlan: "free",
    quota: { free: PLANS.free.slots, premium: PLANS.premium.slots, business: PLANS.business.slots },
    note: "Emplacements serveurs — seul quota déjà appliqué hors shadow.",
  },
  "custom_commands.create": {
    requiredPlan: "free",
    quota: { free: 5, premium: 25, business: 100 },
  },
  "automations.active": {
    requiredPlan: "free",
    quota: { free: 2, premium: 10, business: 50 },
    note: "D-A : automatisations disponibles sur tous les plans, plafonnées.",
  },
  "panel_access.delegate": {
    requiredPlan: "free",
    quota: { free: 1, premium: 3, business: 10 },
    note: "D-D : hors propriétaire ; le RBAC reste prioritaire et n'est jamais élargi.",
  },

  // --- Rétentions (jours) : plafonds appliqués au balayage, informationnel ici ---
  "voice_logs.retention": {
    requiredPlan: "free",
    quota: { free: 7, premium: 30, business: 180 },
    note: "Rétention appliquée par purge, pas par blocage d'action.",
  },
  "stats.retention": {
    requiredPlan: "free",
    quota: { free: 7, premium: 30, business: 180 },
    note: "Rétention appliquée par purge, pas par blocage d'action.",
  },
  "audit.retention": {
    requiredPlan: "free",
    quota: { free: 30, premium: 90, business: 365 },
    note: "Rétention appliquée par purge, pas par blocage d'action.",
  },

  // --- Débloquées par plan ---
  "music.advanced": {
    requiredPlan: "premium",
    note: "D-C : playlists, seek, loop, volume, shuffle, remove.",
  },
  "automod.ai": {
    requiredPlan: "business",
    note: "Non encore livré ; réservé Business.",
  },
};

/* ------------------------------------------------------------------------- */
/* Mapping commandes / sous-commandes musique → capability (D-C)              */
/* ------------------------------------------------------------------------- */

/**
 * Sous-commandes musicales AVANCÉES (Premium+). Tout le reste de la musique
 * (`play`, `pause`, `resume`, `skip`, `stop`, `queue`, `nowplaying`, recherche)
 * reste Free — on ne bloque jamais toute la musique pour un utilisateur Free.
 */
export const ADVANCED_MUSIC_COMMANDS: ReadonlySet<MusicCommand> = new Set<MusicCommand>([
  "playlist_save",
  "playlist_load",
  "seek",
  "loop",
  "volume",
  "shuffle",
  "remove",
]);

/** Capability d'une commande musique (par son `MusicCommand`). */
export function capabilityForMusicCommand(command: MusicCommand): CapabilityId {
  return ADVANCED_MUSIC_COMMANDS.has(command) ? "music.advanced" : "music.use";
}

/**
 * Noms de slash-commands musicales avancées (surface interaction Discord).
 * `playlist` (toutes sous-commandes) est avancé. `seek/loop/volume/shuffle/remove`
 * aussi. Le reste (`play/pause/resume/skip/stop/queue/nowplaying`) est Free.
 */
const ADVANCED_MUSIC_SLASH = new Set(["playlist", "seek", "loop", "volume", "shuffle", "remove"]);
const MUSIC_SLASH = new Set([
  "play", "pause", "resume", "skip", "stop", "queue", "nowplaying",
  "playlist", "seek", "loop", "volume", "shuffle", "remove",
]);

/**
 * Capability d'une slash-command (nom Discord), ou `null` si la commande n'est
 * soumise à aucune capability (inconnue). `moduleForCommand` couvre le reste :
 * chaque module → sa capability « .use » (Free). La musique est différenciée.
 */
export function capabilityForSlashCommand(
  command: string,
  moduleForCommand: (cmd: string) => string | null,
): CapabilityId | null {
  if (MUSIC_SLASH.has(command)) {
    return ADVANCED_MUSIC_SLASH.has(command) ? "music.advanced" : "music.use";
  }
  const moduleId = moduleForCommand(command);
  if (!moduleId) return null;
  return moduleBaseCapability(moduleId);
}

/** Capability « accès de base » d'un module (Free). `null` si le module n'a pas de gate. */
export function moduleBaseCapability(moduleId: string): CapabilityId | null {
  switch (moduleId) {
    case "general": return "general.config";
    case "moderation": return "moderation.use";
    case "music": return "music.use";
    case "custom_commands": return "custom_commands.use";
    case "tickets": return "tickets.use";
    case "button_roles": return "button_roles.use";
    case "welcome": return "welcome.use";
    case "automod": return "automod.use";
    case "levels": return "levels.use";
    case "starboard": return "starboard.use";
    case "temp_voice": return "temp_voice.use";
    case "voice_logs": return "voice_logs.use";
    case "stats": return "stats.use";
    case "social": return "social.use";
    case "audit": return "audit.view";
    case "health": return "health.view";
    case "panel_access": return "panel_access.view";
    case "automations": return "automations.active";
    default: return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Décision                                                                    */
/* ------------------------------------------------------------------------- */

export interface CapabilityDecision {
  allowed: boolean;
  capability: CapabilityId;
  requiredPlan: PlanId;
  effectivePlan: PlanId;
  reason: CapabilityReason;
  /** Plafond applicable au plan effectif, ou `null` si non quotée. */
  quota: number | null;
  /** Usage courant fourni par l'appelant, ou `null` si non pertinent. */
  usage: number | null;
  enforcementMode: CapabilityEnforcementMode;
  /** Décision THÉORIQUE (indépendante du mode) : la capacité aurait-elle été bloquée ? */
  wouldBlock: boolean;
}

export interface EvaluateCapabilityInput {
  capability: CapabilityId;
  /** Plan effectif RÉSOLU côté serveur (jamais depuis le frontend). */
  effectivePlan: PlanId;
  mode: CapabilityEnforcementMode;
  /** Usage courant (pour une capacité quotée) ; le plafond vient de la policy. */
  usage?: number | null;
  /**
   * Raison précise pour laquelle le plan effectif est Free, si connue
   * (entitlement expiré/révoqué/programmé, guilde non affectée…). Sert à
   * qualifier finement un refus « plan » ; par défaut `plan_required`.
   */
  freeReason?: CapabilityReason | null;
}

/**
 * Évaluation PURE et déterministe d'une capacité. Ne lit jamais D1, ne fait
 * jamais confiance au client. En `off` : autorise sans juger. En `shadow` :
 * calcule la vraie décision (wouldBlock) mais autorise toujours. En `enforce` :
 * applique réellement.
 */
export function evaluateCapability(input: EvaluateCapabilityInput): CapabilityDecision {
  const policy = PLAN_CAPABILITY_POLICY[input.capability];
  const requiredPlan = policy.requiredPlan;
  const effectivePlan = input.effectivePlan;
  const quota = policy.quota ? policy.quota[effectivePlan] : null;
  const usage = input.usage ?? null;

  // Mode off : aucune évaluation bloquante, aucune raison de refus calculée.
  if (input.mode === "off") {
    return {
      allowed: true,
      capability: input.capability,
      requiredPlan,
      effectivePlan,
      reason: "allowed_by_plan",
      quota,
      usage,
      enforcementMode: "off",
      wouldBlock: false,
    };
  }

  const planAllowed = PLANS[effectivePlan].rank >= PLANS[requiredPlan].rank;
  const quotaAllowed = quota === null || usage === null ? true : usage < quota;
  const wouldAllow = planAllowed && quotaAllowed;

  let reason: CapabilityReason;
  if (!planAllowed) {
    reason = input.freeReason ?? "plan_required";
  } else if (!quotaAllowed) {
    reason = "quota_exceeded";
  } else {
    reason = "allowed_by_plan";
  }

  return {
    allowed: input.mode === "enforce" ? wouldAllow : true,
    capability: input.capability,
    requiredPlan,
    effectivePlan,
    reason,
    quota,
    usage,
    enforcementMode: input.mode,
    wouldBlock: !wouldAllow,
  };
}

/* ------------------------------------------------------------------------- */
/* Messages de refus (UX)                                                     */
/* ------------------------------------------------------------------------- */

const PLAN_LABEL_FR: Readonly<Record<PlanId, string>> = {
  free: "Free",
  premium: "Premium",
  business: "Business",
};

/** Libellé humain d'un quota (pour le message « Limite atteinte : … »). */
const QUOTA_LABEL_FR: Partial<Record<CapabilityId, string>> = {
  "slots.assign": "serveurs affectés",
  "custom_commands.create": "commandes personnalisées",
  "automations.active": "automatisations actives",
  "panel_access.delegate": "délégués panel",
};

/**
 * Message de refus utilisateur (Discord). Pur, sans PII. Aucune proposition de
 * paiement (billing OFF) : l'accès Premium est « accordé par Archolabs ».
 */
export function capabilityDenialMessageFr(decision: CapabilityDecision): string {
  if (decision.reason === "quota_exceeded" && decision.quota !== null) {
    const label = QUOTA_LABEL_FR[decision.capability] ?? "éléments";
    return `Limite atteinte : ${decision.usage ?? decision.quota}/${decision.quota} ${label} avec le plan ${PLAN_LABEL_FR[decision.effectivePlan]}.`;
  }
  return (
    `Cette fonctionnalité nécessite le plan ${PLAN_LABEL_FR[decision.requiredPlan]}. ` +
    `Ce serveur utilise actuellement le plan ${PLAN_LABEL_FR[decision.effectivePlan]}.`
  );
}
