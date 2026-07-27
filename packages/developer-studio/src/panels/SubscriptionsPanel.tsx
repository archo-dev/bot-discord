import { useState } from "react";
import type { StudioSubscriptionSummary, StudioSubscriptionsListResponse } from "@bot/shared";
import { studioApi } from "../api.js";
import { usePanel } from "../hooks/usePanel.js";
import { fmtDate, originKindLabel } from "../lib/labels.js";
import type { ActionItem, Column, FilterDef } from "../ui/index.js";
import { DataTable, ErrorState, IdentifierCell, PlanBadge, StatusBadge, TableSkeleton, lifecycleView, useCopyId } from "../ui/index.js";

const SKELETON = ["User", "Plan", "Source", "État", "Début", "Fin"];

const columns: Column<StudioSubscriptionSummary>[] = [
  { id: "user", header: "User", cell: (s) => <IdentifierCell value={s.userId} label="l'identifiant utilisateur" />, mobile: "title" },
  { id: "plan", header: "Plan", cell: (s) => <PlanBadge plan={s.planId} />, mobile: "badge" },
  { id: "source", header: "Source", cell: (s) => originKindLabel(s.originKind, s.isLifetime), mobile: "secondary" },
  { id: "state", header: "État", cell: (s) => { const v = lifecycleView(s.effectiveState); return <StatusBadge tone={v.tone}>{v.label}</StatusBadge>; }, mobile: "badge" },
  { id: "start", header: "Début", cell: (s) => fmtDate(s.startAt), sort: (s) => s.startAt, mobile: "secondary" },
  { id: "end", header: "Fin", cell: (s) => (s.isLifetime ? "À vie" : fmtDate(s.endAt)), sort: (s) => s.endAt ?? "", mobile: "meta" },
];

const filters: FilterDef<StudioSubscriptionSummary>[] = [
  { id: "plan", label: "Plan", options: [{ value: "business", label: "Business" }, { value: "premium", label: "Premium" }, { value: "free", label: "Gratuit" }], test: (s, v) => s.planId === v },
  { id: "state", label: "État", options: [{ value: "active", label: "Actif" }, { value: "scheduled", label: "Programmé" }, { value: "expired", label: "Expiré" }, { value: "revoked", label: "Révoqué" }], test: (s, v) => s.effectiveState === v },
  { id: "type", label: "Type", options: [{ value: "paid", label: "Abonnement" }, { value: "granted", label: "Accès offert" }, { value: "early_access", label: "Accès bêta" }], test: (s, v) => s.originKind === v },
];

export function SubscriptionsPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioSubscriptionsListResponse>(() => studioApi.subscriptions(page), page);
  const copyId = useCopyId();
  if (error) return <ErrorState code={error} onRetry={retry} />;
  if (!data) return <TableSkeleton headers={SKELETON} />;

  const actions = (s: StudioSubscriptionSummary): ActionItem[] => [{ label: "Copier l'identifiant utilisateur", onClick: () => copyId(s.userId) }];

  return (
    <DataTable
      rows={data.items}
      columns={columns}
      rowId={(s) => String(s.id)}
      search={(s) => `${s.userId} ${s.planId} ${s.source}`}
      searchPlaceholder="Rechercher un abonnement…"
      filters={filters}
      actions={actions}
      pager={{ page: data.page, pageSize: data.pageSize, total: data.total, onPage: setPage }}
      pageScoped
      empty={{ icon: "card", title: "Aucun abonnement enregistré", description: "Aucun entitlement n'a encore été créé sur la plateforme." }}
    />
  );
}
