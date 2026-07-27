import { useState } from "react";
import type { StudioAuditEvent, StudioAuditPage } from "@bot/shared";
import { studioApi } from "../api.js";
import { usePanel } from "../hooks/usePanel.js";
import { auditActionLabel, auditActorLabel } from "../lib/labels.js";
import type { ActionItem, Column, FilterDef } from "../ui/index.js";
import { DataTable, ErrorState, IdentifierCell, RelativeDateCell, TableSkeleton, useCopyId } from "../ui/index.js";

const SKELETON = ["Date", "Acteur", "Action", "Cible"];

const columns: Column<StudioAuditEvent>[] = [
  { id: "date", header: "Date", cell: (e) => <RelativeDateCell iso={e.createdAt} />, sort: (e) => e.createdAt, mobile: "meta" },
  { id: "actor", header: "Acteur", cell: (e) => auditActorLabel(e.actor), mobile: "secondary" },
  { id: "action", header: "Action", cell: (e) => <span className="text-zinc-200">{auditActionLabel(e.action)}</span>, sort: (e) => e.action, mobile: "title" },
  { id: "target", header: "Cible", cell: (e) => (e.targetType ? <span className="inline-flex items-center gap-1.5"><span className="text-zinc-500">{e.targetType}</span>{e.targetId ? <IdentifierCell value={e.targetId} label="l'identifiant cible" /> : null}</span> : <span className="text-zinc-500">—</span>), mobile: "secondary" },
];

const filters: FilterDef<StudioAuditEvent>[] = [
  { id: "actor", label: "Acteur", options: [{ value: "operator", label: "Opérateur" }, { value: "system", label: "Système" }], test: (e, v) => (v === "system" ? e.actor === "system" : e.actor.startsWith("operator:")) },
];

export function AuditPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioAuditPage>(() => studioApi.audit(page), page);
  const copyId = useCopyId();
  if (error) return <ErrorState code={error} onRetry={retry} />;
  if (!data) return <TableSkeleton headers={SKELETON} />;

  const actions = (e: StudioAuditEvent): ActionItem[] =>
    e.targetId ? [{ label: "Copier l'identifiant cible", onClick: () => copyId(e.targetId as string) }] : [];

  return (
    <DataTable
      rows={data.items}
      columns={columns}
      rowId={(e) => String(e.id)}
      search={(e) => `${e.action} ${e.actor} ${e.targetId ?? ""}`}
      searchPlaceholder="Rechercher dans l'audit…"
      filters={filters}
      actions={actions}
      pager={{ page: data.page, pageSize: data.pageSize, total: data.total, onPage: setPage }}
      pageScoped
      empty={{ icon: "shield", title: "Aucun événement d'audit", description: "Le journal immuable se remplit dès la première action opérateur." }}
    />
  );
}
