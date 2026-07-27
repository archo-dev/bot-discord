import { useState } from "react";
import type { StudioGuildSummary, StudioGuildsListResponse } from "@bot/shared";
import { studioApi } from "../api.js";
import { usePanel } from "../hooks/usePanel.js";
import type { ActionItem, Column, FilterDef } from "../ui/index.js";
import { DataTable, ErrorState, IdentifierCell, RelativeDateCell, StatusBadge, TableSkeleton, useCopyId } from "../ui/index.js";

const SKELETON = ["ID", "Nom", "Bot", "Créé"];

const columns: Column<StudioGuildSummary>[] = [
  { id: "id", header: "ID", cell: (g) => <IdentifierCell value={g.id} label="l'identifiant de la guilde" />, mobile: "secondary" },
  { id: "name", header: "Nom", cell: (g) => g.name ?? "—", sort: (g) => g.name ?? "", mobile: "title" },
  { id: "bot", header: "Bot", cell: (g) => (g.botInstalled ? <StatusBadge tone="success">Installé</StatusBadge> : <StatusBadge tone="neutral">Absent</StatusBadge>), mobile: "badge" },
  { id: "createdAt", header: "Créé", cell: (g) => <RelativeDateCell iso={g.createdAt} />, sort: (g) => g.createdAt, mobile: "meta" },
];

const filters: FilterDef<StudioGuildSummary>[] = [
  { id: "bot", label: "Bot", options: [{ value: "in", label: "Installé" }, { value: "out", label: "Absent" }], test: (g, v) => (v === "in" ? g.botInstalled : !g.botInstalled) },
];

export function GuildsPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioGuildsListResponse>(() => studioApi.guilds(page), page);
  const copyId = useCopyId();
  if (error) return <ErrorState code={error} onRetry={retry} />;
  if (!data) return <TableSkeleton headers={SKELETON} />;

  const actions = (g: StudioGuildSummary): ActionItem[] => [{ label: "Copier l'identifiant", onClick: () => copyId(g.id) }];

  return (
    <DataTable
      rows={data.items}
      columns={columns}
      rowId={(g) => g.id}
      search={(g) => `${g.id} ${g.name ?? ""}`}
      searchPlaceholder="Rechercher une guilde…"
      filters={filters}
      actions={actions}
      pager={{ page: data.page, pageSize: data.pageSize, total: data.total, onPage: setPage }}
      pageScoped
      empty={{ icon: "server", title: "Aucune guilde enregistrée", description: "Les guildes apparaissent après la première interaction du bot sur un serveur." }}
    />
  );
}
