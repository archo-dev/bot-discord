import type { StudioAuditEvent } from "@bot/shared";
import { auditActionLabel, auditActorLabel } from "../../lib/labels.js";
import { relativeTimeFr } from "../../lib/format.js";
import type { Tab } from "../../lib/nav.js";

/**
 * Recent operator activity from the existing audit page (when the operator has
 * audit.read). Shows a clean empty state otherwise — never invents entries and
 * never opens a new endpoint.
 */
export function RecentActivity({
  events,
  canAudit,
  onNavigate,
}: {
  events: StudioAuditEvent[] | null;
  canAudit: boolean;
  onNavigate: (tab: Tab) => void;
}) {
  const items = (events ?? []).slice(0, 6);
  const emptyLabel = !canAudit
    ? "Journal d'audit non accessible."
    : "Aucune activité récente.";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <span className="text-sm font-semibold text-zinc-100">Activité récente</span>
        {canAudit && (
          <button
            type="button"
            onClick={() => onNavigate("audit")}
            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300"
          >
            Journal complet →
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-500">{emptyLabel}</div>
      ) : (
        <ul>
          {items.map((e, i) => (
            <li key={e.id} className={i > 0 ? "border-t border-zinc-800" : undefined}>
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-200">{auditActionLabel(e.action)}</div>
                  <div className="truncate text-[11px] text-zinc-500">
                    {auditActorLabel(e.actor)}
                    {e.targetType ? ` · ${e.targetType}${e.targetId ? ` ${e.targetId}` : ""}` : ""}
                  </div>
                </div>
                <span className="whitespace-nowrap text-[11px] text-zinc-500">
                  {relativeTimeFr(e.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
