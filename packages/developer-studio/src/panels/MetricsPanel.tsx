import type { StudioMetricsResponse, StudioMetricsSummary } from "@bot/shared";
import { studioApi } from "../api.js";
import { usePanel } from "../hooks/usePanel.js";
import type { Column, FilterDef } from "../ui/index.js";
import { CountCell, DataTable, ErrorState, TableSkeleton } from "../ui/index.js";

const SKELETON = ["Module", "Events", "Erreurs", "Taux", "≤500ms", ">5s"];

const columns: Column<StudioMetricsSummary>[] = [
  { id: "module", header: "Module", cell: (m) => <span className="text-zinc-200">{m.module}</span>, sort: (m) => m.module, mobile: "title" },
  { id: "events", header: "Events", cell: (m) => <CountCell value={m.events} />, sort: (m) => m.events, align: "right", mobile: "secondary" },
  { id: "errors", header: "Erreurs", cell: (m) => <CountCell value={m.errors} />, sort: (m) => m.errors, align: "right", mobile: "badge" },
  { id: "rate", header: "Taux", cell: (m) => <span className="tabular-nums text-zinc-300">{(m.errorRate * 100).toFixed(1)}%</span>, sort: (m) => m.errorRate, align: "right", mobile: "secondary" },
  { id: "le500", header: "≤500ms", cell: (m) => <CountCell value={m.latencyLe100 + m.latencyLe250 + m.latencyLe500} />, align: "right" },
  { id: "gt5s", header: ">5s", cell: (m) => <CountCell value={m.latencyGt5000} />, sort: (m) => m.latencyGt5000, align: "right" },
];

const filters: FilterDef<StudioMetricsSummary>[] = [
  { id: "errs", label: "Type", options: [{ value: "with", label: "Avec erreurs" }, { value: "clean", label: "Sans erreur" }], test: (m, v) => (v === "with" ? m.errors > 0 : m.errors === 0) },
];

export function MetricsPanel() {
  const { data, error, retry } = usePanel<StudioMetricsResponse>(() => studioApi.metrics());
  if (error) return <ErrorState code={error} onRetry={retry} />;
  if (!data) return <TableSkeleton headers={SKELETON} />;

  return (
    <DataTable
      rows={data.modules}
      columns={columns}
      rowId={(m) => m.module}
      search={(m) => m.module}
      searchPlaceholder="Rechercher un module…"
      filters={filters}
      empty={{ icon: "activity", title: "Aucune métrique agrégée", description: "Aucun évènement observé sur la période courante." }}
      toolbarExtra={<span>Fenêtre {data.windowHours} h · {data.totalEvents} évènements · {data.totalErrors} erreurs</span>}
    />
  );
}
