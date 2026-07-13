import type { ModuleState, ModuleStateReason, ModuleStateReasonCode } from "@bot/shared";

export const MODULE_STATE_META: Record<ModuleState, { label: string; tone: "primary" | "success" | "warning" | "danger" | "neutral" }> = {
  enabled: { label: "Actif", tone: "success" },
  disabled: { label: "Désactivé", tone: "neutral" },
  unavailable: { label: "Indisponible", tone: "neutral" },
  degraded: { label: "Dégradé", tone: "warning" },
  misconfigured: { label: "À configurer", tone: "warning" },
  missing_dependency: { label: "Dépendance absente", tone: "warning" },
  missing_permission: { label: "Permission absente", tone: "danger" },
  missing_intent: { label: "Intent absent", tone: "danger" },
  gateway_offline: { label: "Gateway hors ligne", tone: "warning" },
  incompatible_config: { label: "Configuration incompatible", tone: "danger" },
};

const REASON_LABELS: Record<ModuleStateReasonCode, string> = {
  module_enabled: "Le module est opérationnel.",
  module_disabled: "Le module est désactivé.",
  module_unavailable: "Ce module n’est pas disponible.",
  module_not_toggleable: "Ce module est requis par la plateforme.",
  dependency_disabled: "Une dépendance requise est désactivée.",
  gateway_offline: "La Gateway doit être connectée.",
  intent_missing: "Un intent Discord requis n’est pas actif.",
  permission_missing: "Le bot ne possède pas toutes les permissions requises.",
  configuration_missing: "Terminez la configuration avant l’activation.",
  config_version_incompatible: "La configuration doit être mise à niveau.",
  runtime_check_unavailable: "Les vérifications Discord sont temporairement indisponibles.",
  health_degraded: "Le diagnostic récent signale une dégradation.",
  quota_reached: "Un quota de protection est atteint.",
};

export function moduleReasonLabel(reason: ModuleStateReason): string {
  if (reason.code === "dependency_disabled" && reason.dependency) return `Activez d’abord le module « ${reason.dependency} ».`;
  if (reason.code === "intent_missing" && reason.intent) return `Intent Discord manquant : ${reason.intent}.`;
  if (reason.code === "permission_missing" && reason.permission) return `Permission Discord manquante : ${reason.permission}.`;
  return REASON_LABELS[reason.code];
}
