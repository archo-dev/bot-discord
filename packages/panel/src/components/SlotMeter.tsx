import { availableSlots, slotSummaryLabel } from "../lib/slots.js";

/*
 * Jauge d'emplacements de serveurs (M7). Réutilisable — l'écran abonnement (M8)
 * la compose avec les données de GET /api/subscription/assignments. Purement
 * présentiel : reçoit used/total (déjà résolus backend). Accessible.
 */
export function SlotMeter({ used, total, suspended = 0 }: { used: number; total: number; suspended?: number }) {
  const free = availableSlots(used, total);
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="rounded-xl border border-(--border) bg-zinc-900/60 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-zinc-200">Emplacements de serveurs</span>
        <span className="text-sm text-zinc-400">{slotSummaryLabel(used, total)}</span>
      </div>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        aria-label={slotSummaryLabel(used, total)}
      >
        <div className="h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>{free} disponible{free > 1 ? "s" : ""}</span>
        {suspended > 0 && <span className="text-amber-400">{suspended} suspendu{suspended > 1 ? "s" : ""}</span>}
      </div>
    </div>
  );
}
