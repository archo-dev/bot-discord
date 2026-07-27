import { useEffect, useState } from "react";
import type { StudioUpdateSummary, StudioUpdatesListResponse } from "@bot/shared";
import { StudioApiError, studioApi } from "../api.js";
import { errorInfoFr } from "../lib/errors.js";
import type { ActionItem, Column, FilterDef } from "../ui/index.js";
import { ConfirmDialog, DataTable, ErrorState, IdentifierCell, StatusBadge, TableSkeleton, updateStatusView, useCopyId, useToast, RelativeDateCell } from "../ui/index.js";

const SKELETON = ["Slug", "Version", "Titre", "Statut", "Publié"];

const columns: Column<StudioUpdateSummary>[] = [
  { id: "slug", header: "Slug", cell: (u) => <IdentifierCell value={u.slug} label="le slug" />, mobile: "secondary" },
  { id: "version", header: "Version", cell: (u) => u.version ?? "—" },
  { id: "title", header: "Titre", cell: (u) => <span className="text-zinc-200">{u.title}</span>, sort: (u) => u.title, mobile: "title" },
  { id: "status", header: "Statut", cell: (u) => { const v = updateStatusView(u.status); return <StatusBadge tone={v.tone}>{v.label}</StatusBadge>; }, mobile: "badge" },
  { id: "published", header: "Publié", cell: (u) => <RelativeDateCell iso={u.publishedAt} />, sort: (u) => u.publishedAt ?? "", mobile: "meta" },
];

const filters: FilterDef<StudioUpdateSummary>[] = [
  { id: "status", label: "Statut", options: [{ value: "draft", label: "Brouillon" }, { value: "scheduled", label: "Programmé" }, { value: "published", label: "Publié" }, { value: "archived", label: "Archivé" }], test: (u, v) => u.status === v },
];

export function UpdatesPanel() {
  const [data, setData] = useState<StudioUpdatesListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<StudioUpdateSummary | null>(null);
  const [page, setPage] = useState(1);
  const toast = useToast();
  const copyId = useCopyId();

  const reload = () => {
    setError(null);
    return studioApi.updates(page).then(setData).catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "network_error"));
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const confirmPublish = async () => {
    if (!pending) return;
    try {
      await studioApi.publish(pending.slug);
      toast.success("Mise à jour publiée", `« ${pending.title} » est désormais visible.`);
      setPending(null);
      await reload();
    } catch (e) {
      const info = errorInfoFr(e instanceof StudioApiError ? e.code : "error");
      toast.error(info.title, info.description);
    }
  };

  if (error) return <ErrorState code={error} onRetry={() => void reload()} />;
  if (!data) return <TableSkeleton headers={SKELETON} />;

  const actions = (u: StudioUpdateSummary): ActionItem[] => [
    ...(u.status !== "published" ? [{ label: "Publier…", onClick: () => setPending(u) }] : []),
    { label: "Copier le slug", onClick: () => copyId(u.slug) },
  ];

  return (
    <>
      <DataTable
        rows={data.items}
        columns={columns}
        rowId={(u) => u.slug}
        search={(u) => `${u.slug} ${u.title} ${u.version ?? ""}`}
        searchPlaceholder="Rechercher une note…"
        filters={filters}
        actions={actions}
        pager={{ page: data.page, pageSize: data.pageSize, total: data.total, onPage: setPage }}
        pageScoped
        empty={{ icon: "mega", title: "Aucune note de mise à jour", description: "Aucune note de version n'a encore été rédigée." }}
      />

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Publier la mise à jour ?"
        description="La note deviendra immédiatement visible par tous les utilisateurs concernés."
        tone="danger"
        confirmLabel="Publier"
        busyLabel="Publication…"
        onConfirm={confirmPublish}
      >
        {pending && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 text-sm text-zinc-300">
            <div className="font-semibold text-zinc-100">{pending.title}</div>
            <div className="mt-0.5 text-xs text-zinc-500">{pending.slug}</div>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
