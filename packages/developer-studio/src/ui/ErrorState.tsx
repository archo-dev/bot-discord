import { NavIcon } from "../components/NavIcon.js";
import { errorInfoFr } from "../lib/errors.js";

/**
 * Reusable error state (Lot 4). Shows a FR title + description from the known
 * error map, an optional Retry, an optional correlation id (only when one
 * already exists), and the raw code hidden behind a collapsed <details>. Never
 * renders a stack trace or a raw response body.
 */
export function ErrorState({
  code,
  onRetry,
  correlationId,
}: {
  code: string;
  onRetry?: () => void;
  correlationId?: string;
}) {
  const info = errorInfoFr(code);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/50 px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-red-950/60 text-red-400">
        <NavIcon name="alert" className="size-6" />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-zinc-100">{info.title}</h3>
      <p className="mt-1 text-sm text-zinc-400">{info.description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
        >
          Réessayer
        </button>
      )}
      {correlationId && (
        <p className="mt-3 text-[11px] text-zinc-600">Référence : {correlationId}</p>
      )}
      <details className="mt-3 text-[11px] text-zinc-600">
        <summary className="cursor-pointer select-none">Détails techniques</summary>
        <code className="mt-1 block font-mono">{code}</code>
      </details>
    </div>
  );
}
