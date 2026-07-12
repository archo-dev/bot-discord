import type { ReactNode } from "react";
import { Button } from "./buttons.js";

/* Kit Nocturne — retours d'état : Badge (5.5), EmptyState (v2 §4.5), ErrorCard (v2 §5), Tooltip (v2 §4.7). */

type BadgeTone = "primary" | "success" | "warning" | "danger" | "neutral";
const badgeTones: Record<BadgeTone, string> = {
  primary: "bg-indigo-950 text-indigo-200",
  success: "bg-green-950 text-green-300",
  warning: "bg-amber-950 text-amber-200",
  danger: "bg-red-950 text-red-300",
  neutral: "bg-zinc-800 text-zinc-400",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

/* --- v2 §4.5 État vide --- */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--surface-2) text-zinc-500" aria-hidden>
        {icon}
      </span>
      <p className="mt-3 text-sm font-semibold text-zinc-100">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-zinc-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* --- v2 §5 Erreur de lecture : icône danger + message clair + « Réessayer » --- */
export function ErrorCard({
  message = "Impossible de charger les données.",
  onRetry,
}: {
  message?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-zinc-800 bg-zinc-900 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-950 text-red-400" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinejoin="round" />
        </svg>
      </span>
      <p className="mt-3 text-sm text-zinc-300">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

/* --- v2 §4.7 Tooltip (CSS pur : survol + focus-within) --- */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-(--z-tooltip) mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-(--surface-3) px-2.5 py-1.5 text-xs text-zinc-100 opacity-0 shadow-(--shadow-md) transition-opacity delay-300 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100 group-focus-within/tt:delay-0"
      >
        {content}
      </span>
    </span>
  );
}
