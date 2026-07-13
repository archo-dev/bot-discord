import type { HealthState } from "@bot/shared";

export const healthStateMeta: Record<
  HealthState,
  { label: string; tone: "success" | "warning" | "danger" | "neutral"; dot: string }
> = {
  operational: { label: "Opérationnel", tone: "success", dot: "bg-green-400" },
  degraded: { label: "Dégradé", tone: "warning", dot: "bg-amber-300" },
  unavailable: { label: "Indisponible", tone: "danger", dot: "bg-red-400" },
  inactive: { label: "Inactif", tone: "neutral", dot: "bg-zinc-500" },
};

export const formatSuccessRate = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1)} %`;

export const formatP95 = (value: number | null): string =>
  value === null ? "—" : `≤ ${value.toLocaleString("fr-FR")} ms`;
