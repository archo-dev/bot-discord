import type { StudioErrorsResponse } from "@bot/shared";
import type { Tab } from "../../lib/nav.js";

/**
 * Operator priorities, from data already fetched by the Overview only:
 *   - high-priority open tickets (count from /studio-api/overview);
 *   - recent errors (from /studio-api/errors, when permitted).
 * No fabricated indicators; renders a clean empty state when nothing is urgent.
 * Each row is gated by the same permission as its destination page.
 */
export function PrioritySection({
  openTicketsHigh,
  errors,
  canSupport,
  canErrors,
  onNavigate,
}: {
  openTicketsHigh: number;
  errors: StudioErrorsResponse | null;
  canSupport: boolean;
  canErrors: boolean;
  onNavigate: (tab: Tab) => void;
}) {
  const totalErrors = errors ? errors.items.reduce((sum, b) => sum + b.errors, 0) : 0;
  const topBuckets = errors
    ? [...errors.items].sort((a, b) => b.errors - a.errors).filter((b) => b.errors > 0).slice(0, 3)
    : [];

  const showTickets = canSupport && openTicketsHigh > 0;
  const showErrors = canErrors && totalErrors > 0;
  const hasAnything = showTickets || showErrors;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
        Priorités opérateur
      </div>
      {!hasAnything ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-500">
          Aucune action prioritaire pour le moment.
        </div>
      ) : (
        <ul>
          {showTickets && (
            <li>
              <button
                type="button"
                onClick={() => onNavigate("support")}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/60"
              >
                <span className="size-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-zinc-100">Tickets haute priorité</span>
                  <span className="block text-[11px] text-zinc-500">À traiter dans le support</span>
                </span>
                <span className="text-sm font-bold text-zinc-100">{openTicketsHigh}</span>
              </button>
            </li>
          )}
          {showErrors && (
            <li className={showTickets ? "border-t border-zinc-800" : undefined}>
              <button
                type="button"
                onClick={() => onNavigate("errors")}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/60"
              >
                <span className="size-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-zinc-100">
                    Erreurs récentes ({errors?.windowHours} h)
                  </span>
                  <span className="block truncate text-[11px] text-zinc-500">
                    {topBuckets.length > 0
                      ? topBuckets.map((b) => `${b.module}·${b.operation} (${b.errors})`).join(" · ")
                      : "Voir le détail des erreurs"}
                  </span>
                </span>
                <span className="text-sm font-bold text-zinc-100">{totalErrors}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
