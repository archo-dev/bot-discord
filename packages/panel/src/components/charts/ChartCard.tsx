import { useId, type ReactNode } from "react";
import { Icon } from "../../ui/icons.js";
import { Skeleton } from "../../ui/skeleton.js";

export function ChartCard({
  title,
  description,
  action,
  legend,
  loading = false,
  error = null,
  onRetry,
  empty = false,
  emptyTitle = "Aucune donnée",
  emptyDescription = "Aucune valeur exploitable n’est disponible pour cette visualisation.",
  summary,
  footer,
  minHeight = 300,
  className = "",
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  legend?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  summary?: string;
  footer?: ReactNode;
  minHeight?: number;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const summaryId = useId();
  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={`${descriptionId}${summary ? ` ${summaryId}` : ""}`}
      className={`overflow-hidden rounded-xl border border-zinc-800/90 bg-[linear-gradient(150deg,rgba(29,26,40,0.98),rgba(22,20,31,0.98))] shadow-(--shadow-card) ${className}`}
    >
      <div className="flex flex-col gap-3 border-b border-zinc-800/75 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-[15px] font-semibold text-zinc-100">{title}</h2>
          <p id={descriptionId} className="mt-0.5 text-xs leading-relaxed text-zinc-400">{description}</p>
        </div>
        {action && <div className="shrink-0 self-start">{action}</div>}
      </div>

      {legend && !loading && !error && !empty && (
        <div className="border-b border-zinc-800/60 px-4 py-2">{legend}</div>
      )}

      <div className="px-3 py-3 sm:px-4" style={{ minHeight }}>
        {loading ? (
          <ChartSkeleton height={minHeight - 24} />
        ) : error ? (
          <ChartError message={error} onRetry={onRetry} minHeight={minHeight - 24} />
        ) : empty ? (
          <ChartEmpty title={emptyTitle} description={emptyDescription} minHeight={minHeight - 24} />
        ) : (
          children
        )}
      </div>

      {summary && !loading && !error && (
        <p id={summaryId} className="border-t border-zinc-800/70 bg-zinc-950/20 px-4 py-2.5 text-[11px] leading-relaxed text-zinc-400">
          <span className="font-semibold text-zinc-300">Résumé : </span>
          {summary}
        </p>
      )}
      {footer && <div className="border-t border-zinc-800/70 px-4 py-2.5">{footer}</div>}
    </section>
  );
}

export function ChartLegend({
  items,
}: {
  items: Array<{ label: string; color: string; value?: string }>;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full ring-2 ring-white/5" style={{ backgroundColor: item.color }} aria-hidden />
          <span className="text-zinc-400">{item.label}</span>
          {item.value && <span className="font-semibold tabular-nums text-zinc-200">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="flex flex-col justify-end gap-3" style={{ height }} aria-busy="true" aria-label="Chargement du graphique">
      <div className="flex flex-1 items-end gap-2 px-1">
        {[42, 66, 51, 82, 62, 74, 56, 88, 70].map((heightPercent, index) => (
          <div key={index} className="min-w-0 flex-1" style={{ height: `${heightPercent}%` }}>
            <Skeleton className="h-full w-full rounded-t-md" />
          </div>
        ))}
      </div>
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

function ChartError({
  message,
  onRetry,
  minHeight,
}: {
  message: string;
  onRetry?: () => void;
  minHeight: number;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-red-900/45 bg-red-950/20 px-4 text-center" style={{ minHeight }}>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-950/70 text-red-300" aria-hidden><Icon.alert /></span>
      <p className="mt-3 text-sm font-semibold text-red-200">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-xs font-semibold text-red-300 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}

function ChartEmpty({
  title,
  description,
  minHeight,
}: {
  title: string;
  description: string;
  minHeight: number;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-950/20 px-4 text-center" style={{ minHeight }}>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-zinc-500" aria-hidden><Icon.chart /></span>
      <p className="mt-3 text-sm font-semibold text-zinc-300">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">{description}</p>
    </div>
  );
}
