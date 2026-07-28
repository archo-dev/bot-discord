import type { ReactNode } from "react";
import { Button } from "./buttons.js";

/* Kit Nocturne — retours d'état : EmptyState (v2 §4.5), ErrorCard (v2 §5), Tooltip (v2 §4.7).
   Badge (5.5) est désormais fourni par @bot/ui (première primitive partagée, M1) et
   ré-exporté ici pour préserver les imports existants (`../ui/kit`). */
export { Badge } from "@bot/ui";
export type { BadgeTone } from "@bot/ui";

/* --- v2 §4.5 État vide --- */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      data-ux-state="empty"
      className={`flex flex-col items-center text-center ${compact ? "py-3" : "py-6"}`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--surface-2) text-zinc-500" aria-hidden>
        {icon}
      </span>
      <p className="mt-3 text-sm font-semibold text-zinc-100">{title}</p>
      {description && <p className="mt-1 max-w-sm text-body leading-relaxed text-zinc-400">{description}</p>}
      {action && <div className={compact ? "mt-3" : "mt-4"}>{action}</div>}
    </div>
  );
}

/* --- v2 §5 Erreur de lecture : icône danger + message clair + « Réessayer » --- */
export function ErrorCard({
  title = "Chargement impossible",
  message = "Impossible de charger les données.",
  onRetry,
  retrying = false,
  detail,
  compact = false,
}: {
  title?: ReactNode;
  message?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  detail?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      data-ux-state="read-error"
      role="alert"
      className={`flex flex-col items-center rounded-xl border border-red-950/80 bg-zinc-900 px-4 text-center ${compact ? "py-5" : "py-8"}`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-950 text-red-400" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinejoin="round" />
        </svg>
      </span>
      <p className="mt-3 text-sm font-semibold text-zinc-100">{title}</p>
      <p className="mt-1 max-w-lg text-sm leading-relaxed text-zinc-400">{message}</p>
      {detail && <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">{detail}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry} loading={retrying}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

export type OperationalStateKind =
  | "readonly"
  | "permission"
  | "admin"
  | "gateway"
  | "quota"
  | "module"
  | "info";

const STATE_STYLES: Record<OperationalStateKind, { border: string; surface: string; title: string }> = {
  readonly: { border: "border-amber-900/60", surface: "bg-amber-950/25", title: "text-amber-200" },
  permission: { border: "border-red-950/80", surface: "bg-red-950/20", title: "text-red-200" },
  admin: { border: "border-red-950/80", surface: "bg-red-950/20", title: "text-red-200" },
  gateway: { border: "border-amber-900/60", surface: "bg-amber-950/25", title: "text-amber-200" },
  quota: { border: "border-amber-900/60", surface: "bg-amber-950/25", title: "text-amber-200" },
  module: { border: "border-zinc-700", surface: "bg-zinc-900", title: "text-zinc-100" },
  info: { border: "border-indigo-900/60", surface: "bg-indigo-950/20", title: "text-indigo-200" },
};

/**
 * État métier persistant. Contrairement à un toast, il reste dans la zone
 * concernée et explicite l'impact ainsi que la prochaine action réaliste.
 */
export function OperationalState({
  kind,
  title,
  description,
  impact,
  available,
  action,
  compact = false,
}: {
  kind: OperationalStateKind;
  title: ReactNode;
  description: ReactNode;
  impact?: ReactNode;
  available?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  const style = STATE_STYLES[kind];
  const urgent = kind === "permission" || kind === "admin" || kind === "quota";
  return (
    <section
      data-ux-state={kind}
      role={urgent ? "alert" : "status"}
      className={`min-w-0 rounded-xl border ${style.border} ${style.surface} ${compact ? "px-3 py-2.5" : "px-4 py-3.5"}`}
    >
      <h3 className={`text-sm font-semibold ${style.title}`}>{title}</h3>
      <p className="mt-1 break-words text-sm leading-relaxed text-zinc-400">{description}</p>
      {(impact || available) && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          {impact && <div><dt className="font-semibold text-zinc-300">Impact</dt><dd className="mt-0.5 text-zinc-500">{impact}</dd></div>}
          {available && <div><dt className="font-semibold text-zinc-300">Toujours disponible</dt><dd className="mt-0.5 text-zinc-500">{available}</dd></div>}
        </dl>
      )}
      {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </section>
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
