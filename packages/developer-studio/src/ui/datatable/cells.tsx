import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@bot/ui";
import type { EntitlementLifecycleState, PlanId, StudioTicketPriority } from "@bot/shared";
import { fullDateFr, relativeTimeFr } from "../../lib/format.js";
import { lifecycleStateLabel } from "../../lib/labels.js";
import { useToast } from "../toast.js";

/* ------------------------------------------------------------------ Badges */

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}

export function PriorityBadge({ priority }: { priority: StudioTicketPriority }) {
  const v = priorityView(priority);
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

export function PlanBadge({ plan }: { plan: PlanId | string }) {
  const v = planView(plan);
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

/* -------------------------------------------------------------- View maps */

export function priorityView(p: StudioTicketPriority): { tone: BadgeTone; label: string } {
  switch (p) {
    case "high": return { tone: "danger", label: "Haute" };
    case "normal": return { tone: "warning", label: "Normale" };
    default: return { tone: "neutral", label: "Basse" };
  }
}

export function planView(plan: PlanId | string): { tone: BadgeTone; label: string } {
  switch (plan) {
    case "business": return { tone: "primary", label: "Business" };
    case "premium": return { tone: "success", label: "Premium" };
    case "free": return { tone: "neutral", label: "Gratuit" };
    default: return { tone: "neutral", label: String(plan) };
  }
}

export function ticketStatusView(status: string): { tone: BadgeTone; label: string } {
  switch (status) {
    case "open": return { tone: "warning", label: "Ouvert" };
    case "pending": return { tone: "neutral", label: "En attente" };
    case "resolved": return { tone: "success", label: "Résolu" };
    case "closed": return { tone: "neutral", label: "Clos" };
    default: return { tone: "neutral", label: status };
  }
}

export function updateStatusView(status: string): { tone: BadgeTone; label: string } {
  switch (status) {
    case "draft": return { tone: "neutral", label: "Brouillon" };
    case "scheduled": return { tone: "warning", label: "Programmé" };
    case "published": return { tone: "success", label: "Publié" };
    case "archived": return { tone: "neutral", label: "Archivé" };
    default: return { tone: "neutral", label: status };
  }
}

export function lifecycleView(state: EntitlementLifecycleState): { tone: BadgeTone; label: string } {
  const label = lifecycleStateLabel(state);
  switch (state) {
    case "active": return { tone: "success", label };
    case "scheduled": return { tone: "primary", label };
    case "revoked":
    case "past_due": return { tone: "danger", label };
    case "suspended": return { tone: "warning", label };
    default: return { tone: "neutral", label };
  }
}

/* --------------------------------------------------------------- Date cell */

/** Relative date visible, full FR date in the native tooltip. */
export function RelativeDateCell({ iso }: { iso: string | null }) {
  return (
    <span title={fullDateFr(iso)} className="whitespace-nowrap text-zinc-400">
      {relativeTimeFr(iso)}
    </span>
  );
}

/* ------------------------------------------------------------ Identifiers */

function shorten(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

/** Copy a raw value to the clipboard verbatim + confirmation toast. */
export function useCopyId(): (value: string, label?: string) => void {
  const toast = useToast();
  return (value: string) => {
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success("Identifiant copié", value))
      .catch(() => toast.error("Copie impossible", "Le presse-papiers n'est pas accessible."));
  };
}

/**
 * Discord-id / slug cell: truncated mono display, full value in title + copy
 * button. The copied value is always the untouched original.
 */
export function IdentifierCell({ value, label }: { value: string; label?: string }) {
  const copyId = useCopyId();
  const copy = () => copyId(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span title={value} className="font-mono text-xs text-zinc-300">
        {shorten(value)}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copier ${label ?? "l'identifiant"} ${value}`}
        className="rounded p-0.5 text-zinc-500 hover:text-indigo-400 focus-visible:text-indigo-400"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
    </span>
  );
}

export function UserCell({ userId }: { userId: string }) {
  return <IdentifierCell value={userId} label="l'identifiant utilisateur" />;
}

export function GuildCell({ id, name }: { id: string | null; name?: string | null }) {
  if (!id) return <span className="text-zinc-500">—</span>;
  if (name) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="truncate text-zinc-200">{name}</span>
        <IdentifierCell value={id} label="l'identifiant de la guilde" />
      </span>
    );
  }
  return <IdentifierCell value={id} label="l'identifiant de la guilde" />;
}

export function CountCell({ value }: { value: number }) {
  return <span className={value === 0 ? "tabular-nums text-zinc-600" : "tabular-nums text-zinc-200"}>{value}</span>;
}
