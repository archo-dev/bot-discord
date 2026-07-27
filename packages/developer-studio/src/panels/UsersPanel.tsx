import { useState } from "react";
import type { StudioUserSummary, StudioUsersListResponse } from "@bot/shared";
import { studioApi } from "../api.js";
import { usePanel } from "../hooks/usePanel.js";
import type { ActionItem, Column } from "../ui/index.js";
import { CountCell, DataTable, ErrorState, IdentifierCell, RelativeDateCell, TableSkeleton, useCopyId } from "../ui/index.js";

const SKELETON = ["User ID", "Entitlements actifs", "Tickets support", "Dernière activité"];

const columns: Column<StudioUserSummary>[] = [
  { id: "userId", header: "User ID", cell: (u) => <IdentifierCell value={u.userId} label="l'identifiant utilisateur" />, mobile: "title" },
  { id: "entitlements", header: "Entitlements actifs", cell: (u) => <CountCell value={u.activeEntitlements} />, sort: (u) => u.activeEntitlements, align: "right", mobile: "secondary" },
  { id: "tickets", header: "Tickets support", cell: (u) => <CountCell value={u.supportTickets} />, sort: (u) => u.supportTickets, align: "right", mobile: "secondary" },
  { id: "lastActivity", header: "Dernière activité", cell: (u) => <RelativeDateCell iso={u.lastActivityAt} />, sort: (u) => u.lastActivityAt, mobile: "meta" },
];

export function UsersPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioUsersListResponse>(() => studioApi.users(page), page);
  const copyId = useCopyId();
  if (error) return <ErrorState code={error} onRetry={retry} />;
  if (!data) return <TableSkeleton headers={SKELETON} />;

  const actions = (u: StudioUserSummary): ActionItem[] => [{ label: "Copier l'identifiant", onClick: () => copyId(u.userId) }];

  return (
    <DataTable
      rows={data.items}
      columns={columns}
      rowId={(u) => u.userId}
      search={(u) => u.userId}
      searchPlaceholder="Rechercher un utilisateur…"
      actions={actions}
      pager={{ page: data.page, pageSize: data.pageSize, total: data.total, onPage: setPage }}
      pageScoped
      empty={{ icon: "users", title: "Aucun utilisateur connu", description: "Les utilisateurs connus sont dérivés des tables opérationnelles existantes." }}
    />
  );
}
