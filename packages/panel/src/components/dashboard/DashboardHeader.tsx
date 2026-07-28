import { Button } from "../../ui/kit.js";
import { Icon } from "../../ui/icons.js";

function formatRefreshTime(timestamp: number | null): string {
  if (timestamp === null) return "Non disponible";
  return new Date(timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DashboardHeader({
  guildName,
  gatewayConnected,
  updatedAt,
  refreshing,
  refreshAnnouncement,
  onRefresh,
}: {
  guildName: string;
  gatewayConnected: boolean;
  updatedAt: number | null;
  refreshing: boolean;
  refreshAnnouncement: string;
  onRefresh: () => void;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate font-display text-lg font-semibold text-zinc-100">{guildName}</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              gatewayConnected
                ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-400"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${gatewayConnected ? "bg-emerald-400" : "bg-zinc-500"}`} aria-hidden />
            {gatewayConnected ? "Gateway connectée" : "Gateway indisponible"}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
          Signaux disponibles, modération et raccourcis de configuration du serveur.
        </p>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
        <p className="text-[11px] text-zinc-500">
          Dernière actualisation
          <span className="ml-1 font-medium tabular-nums text-zinc-300">{formatRefreshTime(updatedAt)}</span>
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={refreshing}
          onClick={onRefresh}
          aria-label="Actualiser les données du dashboard"
        >
          {!refreshing && <span className="[&_svg]:h-4 [&_svg]:w-4" aria-hidden><Icon.refresh /></span>}
          Actualiser
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{refreshAnnouncement}</p>
    </section>
  );
}
