import type { ReactNode } from "react";

/*
 * Badge « Nocturne » (design_system §5.5) — pastille d'état présentationnelle pure.
 * Première primitive partagée extraite du panel en M1 (@bot/ui). Aucune dépendance
 * au routeur, à l'accès ou au domaine Discord : rendu identique à l'original.
 * S'appuie sur les tokens partagés (@bot/ui/theme.css).
 */

export type BadgeTone = "primary" | "success" | "warning" | "danger" | "neutral";

const badgeTones: Record<BadgeTone, string> = {
  primary: "bg-indigo-950 text-indigo-200",
  success: "bg-green-950 text-green-300",
  warning: "bg-amber-950 text-amber-200",
  danger: "bg-red-950 text-red-300",
  neutral: "bg-zinc-800 text-zinc-400",
};

/** Classes de fond/texte pour un ton donné — fonction pure, testable sans DOM. */
export function badgeToneClass(tone: BadgeTone): string {
  return badgeTones[tone];
}

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-eyebrow font-semibold uppercase tracking-wide ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}
