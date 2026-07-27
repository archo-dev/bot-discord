import { fmtTimeFr, relativeTimeFr } from "../../lib/format.js";

/** Overview page header: title, description, environment, last refresh + action. */
export function OverviewHeader({
  lastUpdatedAt,
  refreshing,
  onRefresh,
}: {
  lastUpdatedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const envLabel = import.meta.env.MODE === "staging" ? "Staging" : "Production";
  const envTone =
    import.meta.env.MODE === "staging"
      ? "bg-amber-950 text-amber-200"
      : "bg-red-950 text-red-300";

  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-zinc-100">Console d'exploitation</h1>
        <p className="mt-0.5 text-sm text-zinc-400">
          État de la production en direct — santé, indicateurs et actions prioritaires.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${envTone}`}>
          {envLabel}
        </span>
        <span className="hidden text-xs text-zinc-500 sm:inline">
          {lastUpdatedAt ? `Actualisé ${relativeTimeFr(lastUpdatedAt)} · ${fmtTimeFr(lastUpdatedAt)}` : "—"}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
          </svg>
          {refreshing ? "Actualisation…" : "Actualiser"}
        </button>
      </div>
    </div>
  );
}
