import type { StudioErrorBucket, StudioErrorsResponse } from "@bot/shared";
import { studioApi } from "../api.js";
import { usePanel } from "../hooks/usePanel.js";
import type { Column } from "../ui/index.js";
import { CountCell, DataTable, ErrorState, TableSkeleton } from "../ui/index.js";

const SKELETON = ["Module", "Opération", "Erreurs", "Events"];

const columns: Column<StudioErrorBucket>[] = [
  { id: "module", header: "Module", cell: (e) => <span className="text-zinc-200">{e.module}</span>, sort: (e) => e.module, mobile: "title" },
  { id: "operation", header: "Opération", cell: (e) => <span className="text-zinc-300">{e.operation}</span>, sort: (e) => e.operation, mobile: "secondary" },
  { id: "errors", header: "Erreurs", cell: (e) => <CountCell value={e.errors} />, sort: (e) => e.errors, align: "right", mobile: "badge" },
  { id: "events", header: "Events", cell: (e) => <CountCell value={e.events} />, sort: (e) => e.events, align: "right", mobile: "meta" },
];

export function ErrorsPanel() {
  const { data, error, retry } = usePanel<StudioErrorsResponse>(() => studioApi.errors());
  if (error) return <ErrorState code={error} onRetry={retry} />;
  if (!data) return <TableSkeleton headers={SKELETON} />;

  return (
    <DataTable
      rows={data.items}
      columns={columns}
      rowId={(e) => `${e.module}:${e.operation}`}
      search={(e) => `${e.module} ${e.operation}`}
      searchPlaceholder="Rechercher une opération…"
      empty={{ icon: "alert", title: "Aucune erreur agrégée", description: "Aucune erreur enregistrée sur la période courante." }}
      toolbarExtra={<span>Fenêtre {data.windowHours} h</span>}
    />
  );
}
