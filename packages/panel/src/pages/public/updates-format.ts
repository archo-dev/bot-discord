/*
 * Helpers PURS pour les notes de mise à jour (M5) — aucune dépendance React/DOM,
 * testables en node. Labels FR des catégories, formatage de date, options de
 * filtre par module. La visibilité (publié / fenêtre) est décidée côté backend.
 */
import type { ReleaseNoteChangeType } from "@bot/shared";

/** Libellé FR d'une catégorie de changement. */
export const CHANGE_TYPE_LABELS: Readonly<Record<ReleaseNoteChangeType, string>> = {
  new: "Nouveautés",
  improved: "Améliorations",
  fixed: "Corrections",
  security: "Sécurité",
};

/** Classe de teinte (tokens Nocturne) par catégorie — jamais la couleur seule. */
export const CHANGE_TYPE_TONE: Readonly<Record<ReleaseNoteChangeType, string>> = {
  new: "bg-indigo-500/15 text-indigo-300",
  improved: "bg-emerald-500/15 text-emerald-300",
  fixed: "bg-amber-500/15 text-amber-300",
  security: "bg-rose-500/15 text-rose-300",
};

/** Date de publication en français long (ex. « 20 juillet 2026 »). Robuste. */
export function formatUpdateDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export interface ModuleFilterOption {
  /** `null` = « Tous ». */
  value: string | null;
  label: string;
}

/** Options de filtre par module : « Tous » + les modules distincts (ordre stable). */
export function moduleFilterOptions(modules: readonly string[]): ModuleFilterOption[] {
  const seen = new Set<string>();
  const options: ModuleFilterOption[] = [{ value: null, label: "Tous" }];
  for (const m of modules) {
    if (typeof m !== "string" || m.length === 0 || seen.has(m)) continue;
    seen.add(m);
    options.push({ value: m, label: m });
  }
  return options;
}
