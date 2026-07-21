/*
 * Feature flags de PLATEFORME (rollout SaaS — plan « platform-split »).
 *
 * Mécanisme M1 : catalogue typé + résolution pure, **désactivés par défaut**.
 * Aucun flag n'active de fonctionnalité produit à ce stade ; ils préparent
 * l'activation/rollback par cohorte des futures briques (public, entitlements,
 * billing…). Le branchement réel (vars Worker → /api/me → panel) viendra quand
 * un flag sera consommé (M2+). Frontière partagée worker/panel/gateway.
 * Voir docs/platform-split/execution/briefs/M1-brief.md (Lot D).
 */

/** Clés de flags connues (rollout SaaS). Étendre ici au fil des milestones. */
export type PlatformFlagKey =
  | "platform.publicSite"
  | "platform.entitlements"
  | "platform.billing"
  | "platform.support"
  | "platform.studio";

export interface PlatformFlagDef {
  readonly key: PlatformFlagKey;
  readonly description: string;
  /** Valeur par défaut — **toujours `false`** tant qu'un milestone ne l'active pas. */
  readonly default: boolean;
}

/** Catalogue canonique des flags de plateforme. */
export const PLATFORM_FLAGS: Readonly<Record<PlatformFlagKey, PlatformFlagDef>> = {
  "platform.publicSite": {
    key: "platform.publicSite",
    description: "Site public (landing, pricing, updates) servi hors session — M2/M3.",
    default: false,
  },
  "platform.entitlements": {
    key: "platform.entitlements",
    description: "Résolution des droits d'accès (entitlements) — M6.",
    default: false,
  },
  "platform.billing": {
    key: "platform.billing",
    description: "Parcours de paiement (checkout hosted, portail) — M9.",
    default: false,
  },
  "platform.support": {
    key: "platform.support",
    description: "Support client (tickets priorisés par plan) — M11.",
    default: false,
  },
  "platform.studio": {
    key: "platform.studio",
    description: "Studio développeur isolé (dev-auth, /studio-api/*) — M12.",
    default: false,
  },
};

/** État résolu : chaque flag connu → booléen. */
export type FlagState = Readonly<Record<PlatformFlagKey, boolean>>;

/**
 * Source d'override (ex. variables Worker injectées). Les clés inconnues et les
 * valeurs non booléennes sont **ignorées** (retour au défaut) — jamais de crash.
 */
export type FlagSource = Readonly<Record<string, unknown>>;

/**
 * Résout l'état des flags de façon **pure et déterministe** : on part des défauts
 * (tous `false`) et on applique uniquement les overrides booléens des clés connues.
 */
export function resolveFlags(source: FlagSource = {}): FlagState {
  const state = {} as Record<PlatformFlagKey, boolean>;
  for (const key of Object.keys(PLATFORM_FLAGS) as PlatformFlagKey[]) {
    const override = source[key];
    state[key] = typeof override === "boolean" ? override : PLATFORM_FLAGS[key].default;
  }
  return state;
}

/** Raccourci : un flag donné est-il actif pour cette source ? */
export function isFlagEnabled(key: PlatformFlagKey, source: FlagSource = {}): boolean {
  return resolveFlags(source)[key];
}
