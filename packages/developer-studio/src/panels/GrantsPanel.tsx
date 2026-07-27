import { useEffect, useState } from "react";
import type { GrantsListResponse } from "@bot/shared";
import { StudioApiError, studioApi } from "../api.js";
import { errorInfoFr } from "../lib/errors.js";
import { originKindLabel } from "../lib/labels.js";
import { GrantWizard } from "../components/grant/GrantWizard.js";
import type { ActionItem, Column, FilterDef } from "../ui/index.js";
import {
  ConfirmDialog,
  DataTable,
  ErrorState,
  IdentifierCell,
  PlanBadge,
  StatusBadge,
  TableSkeleton,
  lifecycleView,
  useCopyId,
  useToast,
} from "../ui/index.js";

const SKELETON = ["User", "Plan", "Source", "Durée", "État", "Raison"];
type GrantRow = GrantsListResponse["items"][number];

export function GrantsPanel({ canGrant, canLifetime, canRevoke }: { canGrant: boolean; canLifetime: boolean; canRevoke: boolean }) {
  const [data, setData] = useState<GrantsListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);
  const toast = useToast();
  const copyId = useCopyId();

  const reload = () => {
    setError(null);
    return studioApi.grants(page).then(setData).catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "network_error"));
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const doRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await studioApi.revoke(revokeTarget.entitlementId);
      toast.success("Accès révoqué", `L'accès de ${revokeTarget.userId} a été révoqué.`);
      setRevokeTarget(null);
      await reload();
    } catch (e) {
      const info = errorInfoFr(e instanceof StudioApiError ? e.code : "error");
      toast.error(info.title, info.description);
    }
  };

  const columns: Column<GrantRow>[] = [
    { id: "user", header: "User", cell: (g) => <IdentifierCell value={g.userId} label="l'identifiant utilisateur" />, mobile: "title" },
    { id: "plan", header: "Plan", cell: (g) => <PlanBadge plan={g.planId} />, mobile: "badge" },
    { id: "source", header: "Source", cell: (g) => originKindLabel(g.originKind, g.isLifetime), mobile: "secondary" },
    { id: "duration", header: "Durée", cell: (g) => (g.isLifetime ? "lifetime" : g.durationKind), mobile: "secondary" },
    { id: "state", header: "État", cell: (g) => { const v = lifecycleView(g.effectiveState); return <StatusBadge tone={v.tone}>{v.label}</StatusBadge>; }, mobile: "badge" },
    { id: "reason", header: "Raison", cell: (g) => g.reason },
  ];

  const filters: FilterDef<GrantRow>[] = [
    { id: "plan", label: "Plan", options: [{ value: "business", label: "Business" }, { value: "premium", label: "Premium" }], test: (g, v) => g.planId === v },
    { id: "state", label: "État", options: [{ value: "active", label: "Actif" }, { value: "scheduled", label: "Programmé" }, { value: "expired", label: "Expiré" }, { value: "revoked", label: "Révoqué" }], test: (g, v) => g.effectiveState === v },
    { id: "type", label: "Type", options: [{ value: "granted", label: "Accès offert" }, { value: "early_access", label: "Accès bêta" }], test: (g, v) => g.originKind === v },
  ];

  const actions = (g: GrantRow): ActionItem[] => [
    { label: "Copier l'identifiant utilisateur", onClick: () => copyId(g.userId) },
    ...(canRevoke && (g.effectiveState === "active" || g.effectiveState === "scheduled")
      ? [{ label: "Révoquer", tone: "danger" as const, onClick: () => setRevokeTarget(g) }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {(canGrant || canLifetime) && <GrantWizard canGrant={canGrant} canLifetime={canLifetime} onGranted={() => void reload()} />}

      {error ? (
        <ErrorState code={error} onRetry={() => void reload()} />
      ) : !data ? (
        <TableSkeleton headers={SKELETON} />
      ) : (
        <DataTable
          rows={data.items}
          columns={columns}
          rowId={(g) => String(g.grantId)}
          search={(g) => `${g.userId} ${g.reason}`}
          searchPlaceholder="Rechercher un octroi…"
          filters={filters}
          actions={actions}
          pager={{ page: data.page, pageSize: data.pageSize, total: data.total, onPage: setPage }}
          pageScoped
          empty={{ icon: "gift", title: "Aucun accès offert", description: "Utilisez l'assistant ci-dessus pour accorder un accès." }}
        />
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Révoquer cet accès offert ?"
        description="L'accès sera immédiatement retiré. Cette action est journalisée."
        tone="danger"
        confirmLabel="Révoquer"
        busyLabel="Révocation…"
        onConfirm={doRevoke}
      >
        {revokeTarget && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 text-sm text-zinc-300">
            <div><span className="text-zinc-500">Utilisateur : </span>{revokeTarget.userId}</div>
            <div><span className="text-zinc-500">Plan : </span>{revokeTarget.planId} · {originKindLabel(revokeTarget.originKind, revokeTarget.isLifetime)}</div>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
