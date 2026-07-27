import { useState } from "react";
import type { StudioSupportListResponse, StudioSupportTicketSummary } from "@bot/shared";
import { studioApi } from "../api.js";
import { usePanel } from "../hooks/usePanel.js";
import type { ActionItem, Column, FilterDef } from "../ui/index.js";
import {
  DataTable,
  ErrorState,
  IdentifierCell,
  PlanBadge,
  PriorityBadge,
  RelativeDateCell,
  StatusBadge,
  TableSkeleton,
  ticketStatusView,
  useCopyId,
} from "../ui/index.js";

const SKELETON = ["Priorité", "Ticket", "Utilisateur", "Guilde", "Plan", "Statut", "Assigné", "Créé"];

const PRIORITY_ORDER = { high: 3, normal: 2, low: 1 } as const;

const columns: Column<StudioSupportTicketSummary>[] = [
  { id: "priority", header: "Priorité", cell: (t) => <PriorityBadge priority={t.priority} />, sort: (t) => PRIORITY_ORDER[t.priority], mobile: "badge" },
  { id: "ticket", header: "Ticket", cell: (t) => <span className="text-zinc-200">#{t.id} · {t.subject}</span>, sort: (t) => t.subject, mobile: "title" },
  { id: "user", header: "Utilisateur", cell: (t) => <IdentifierCell value={t.userId} label="l'identifiant utilisateur" />, mobile: "secondary" },
  { id: "guild", header: "Guilde", cell: (t) => (t.guildId ? <IdentifierCell value={t.guildId} label="l'identifiant de la guilde" /> : <span className="text-zinc-500">—</span>), mobile: "secondary" },
  { id: "plan", header: "Plan", cell: (t) => <PlanBadge plan={t.planAtOpen} />, mobile: "badge" },
  { id: "status", header: "Statut", cell: (t) => { const v = ticketStatusView(t.status); return <StatusBadge tone={v.tone}>{v.label}</StatusBadge>; }, mobile: "badge" },
  { id: "assignee", header: "Assigné", cell: (t) => t.assignee ?? "—" }, // collapsible on mobile
  { id: "createdAt", header: "Créé", cell: (t) => <RelativeDateCell iso={t.createdAt} />, sort: (t) => t.createdAt, mobile: "meta" },
];

const filters: FilterDef<StudioSupportTicketSummary>[] = [
  { id: "priority", label: "Priorité", options: [{ value: "high", label: "Haute" }, { value: "normal", label: "Normale" }, { value: "low", label: "Basse" }], test: (t, v) => t.priority === v },
  { id: "status", label: "Statut", options: [{ value: "open", label: "Ouvert" }, { value: "pending", label: "En attente" }, { value: "resolved", label: "Résolu" }, { value: "closed", label: "Clos" }], test: (t, v) => t.status === v },
  { id: "plan", label: "Plan", options: [{ value: "business", label: "Business" }, { value: "premium", label: "Premium" }, { value: "free", label: "Gratuit" }], test: (t, v) => t.planAtOpen === v },
];

export function SupportPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioSupportListResponse>(() => studioApi.support(page), page);
  const copyId = useCopyId();
  if (error) return <ErrorState code={error} onRetry={retry} />;
  if (!data) return <TableSkeleton headers={SKELETON} />;

  const actions = (t: StudioSupportTicketSummary): ActionItem[] => [
    { label: "Copier l'identifiant utilisateur", onClick: () => copyId(t.userId) },
    ...(t.guildId ? [{ label: "Copier l'identifiant de la guilde", onClick: () => copyId(t.guildId as string) }] : []),
  ];

  return (
    <DataTable
      rows={data.items}
      columns={columns}
      rowId={(t) => String(t.id)}
      search={(t) => `#${t.id} ${t.subject} ${t.userId} ${t.guildId ?? ""}`}
      searchPlaceholder="Rechercher un ticket…"
      filters={filters}
      actions={actions}
      pager={{ page: data.page, pageSize: data.pageSize, total: data.total, onPage: setPage }}
      pageScoped
      empty={{ icon: "life", title: "Aucun ticket support", description: "La file support est vide pour le moment." }}
    />
  );
}
