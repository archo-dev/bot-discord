import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BACKUP_MODULE_LABELS,
  type BackupModuleId,
  type ConfigSnapshotDiff,
  type ConfigSnapshotList,
  type ConfigSnapshotSummary,
  type RestoreResult,
  type SnapshotReason,
} from "@bot/shared";
import { api } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { Badge, Button, Card, EmptyState, ErrorCard } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { Modal } from "../ui/overlay.js";
import { Skeleton } from "../ui/skeleton.js";
import { TimeAgo } from "../ui/mod-meta.js";
import { toast } from "../ui/toast.js";
import { BackupImport } from "./BackupImport.js";

const REASON_META: Record<SnapshotReason, { label: string; tone: "primary" | "neutral" }> = {
  manual: { label: "Manuelle", tone: "primary" },
  pre_restore: { label: "Avant restauration", tone: "neutral" },
  pre_import: { label: "Avant import", tone: "neutral" },
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (Array.isArray(value)) return value.length === 0 ? "(vide)" : value.join(", ");
  return String(value);
}

/** Refetches every config query a restore/import can touch. */
export function invalidateConfigQueries(queryClient: ReturnType<typeof useQueryClient>, guildId: string) {
  for (const key of ["automod", "guild", "log-settings", "onboarding", "config-snapshots"]) {
    void queryClient.invalidateQueries({ queryKey: [key, guildId] });
  }
}

export function BackupPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const [diffId, setDiffId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ConfigSnapshotSummary | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const snapshots = useQuery({
    queryKey: ["config-snapshots", guildId],
    queryFn: () => api<ConfigSnapshotList>(`/api/guilds/${guildId}/config-snapshots`),
  });

  const create = useMutation({
    mutationFn: () => api(`/api/guilds/${guildId}/config-snapshots`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["config-snapshots", guildId] });
      toast.success("Sauvegarde créée.");
    },
    onError: () => toast.error("Création de la sauvegarde impossible."),
  });

  async function exportSnapshot(id: string) {
    try {
      const data = await api<unknown>(`/api/guilds/${guildId}/config-snapshots/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `config-backup-${guildId}-${id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export impossible.");
    }
  }

  if (snapshots.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>;
  if (snapshots.isError) return <ErrorCard message="Impossible de charger les sauvegardes." onRetry={() => void snapshots.refetch()} />;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="font-semibold text-zinc-100">Sauvegarde et restauration</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Photographie la <strong>Configuration générale</strong> et l'<strong>Auto-modération</strong>. Aucun secret
              n'est stocké. Les données métier (tickets, logs, XP) ne sont pas couvertes.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={!canWrite} onClick={() => setImportOpen(true)}>Importer</Button>
            <Button disabled={!canWrite} loading={create.isPending} onClick={() => create.mutate()}>Créer une sauvegarde</Button>
          </div>
        </div>
      </Card>

      {snapshots.data.snapshots.length === 0 ? (
        <Card><EmptyState icon={<Icon.scroll />} title="Aucune sauvegarde" description="Créez une première sauvegarde pour pouvoir restaurer votre configuration plus tard." /></Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-900/50 shadow-(--shadow-sm)">
          <ul className="divide-y divide-zinc-800/70">
            {snapshots.data.snapshots.map((snap) => (
              <li key={snap.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={REASON_META[snap.reason].tone}>{REASON_META[snap.reason].label}</Badge>
                    {snap.modules.map((m) => <span key={m} className="text-xs text-zinc-500">{BACKUP_MODULE_LABELS[m]}</span>)}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500"><TimeAgo iso={snap.createdAt} /> · {(snap.sizeBytes / 1024).toFixed(1)} Ko</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDiffId(snap.id)}>Comparer</Button>
                  <Button size="sm" variant="ghost" onClick={() => void exportSnapshot(snap.id)}>Exporter</Button>
                  <Button size="sm" disabled={!canWrite} onClick={() => setRestoreTarget(snap)}>Restaurer</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-zinc-600">Les {snapshots.data.retentionLimit} sauvegardes les plus récentes sont conservées.</p>

      {diffId && <DiffModal guildId={guildId!} snapshotId={diffId} onClose={() => setDiffId(null)} />}
      {restoreTarget && (
        <RestoreModal
          guildId={guildId!}
          snapshot={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onDone={() => { invalidateConfigQueries(queryClient, guildId!); setRestoreTarget(null); }}
        />
      )}
      {importOpen && <BackupImport guildId={guildId!} onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function DiffModal({ guildId, snapshotId, onClose }: { guildId: string; snapshotId: string; onClose: () => void }) {
  const diff = useQuery({
    queryKey: ["config-snapshot-diff", guildId, snapshotId],
    queryFn: () => api<ConfigSnapshotDiff>(`/api/guilds/${guildId}/config-snapshots/${snapshotId}/diff`),
  });
  const total = diff.data?.modules.reduce((n, m) => n + m.changes.length, 0) ?? 0;
  return (
    <Modal open onClose={onClose} title="Comparaison avec la configuration actuelle" size="2xl">
      {diff.isPending ? <Skeleton className="h-40 rounded-xl" /> : diff.isError ? (
        <ErrorCard message="Impossible de calculer la comparaison." />
      ) : total === 0 ? (
        <p className="text-sm text-zinc-400">La configuration actuelle est identique à cette sauvegarde.</p>
      ) : (
        <div className="space-y-4">
          {diff.data!.modules.filter((m) => m.changes.length > 0).map((module) => (
            <div key={module.module}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{BACKUP_MODULE_LABELS[module.module]}</h3>
              <ul className="space-y-1.5">
                {module.changes.map((change) => (
                  <li key={change.path} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[13px]">
                    <span className="font-mono text-xs text-zinc-500">{change.path}</span>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-zinc-400">Actuel : <span className="text-zinc-200">{formatValue(change.before)}</span></span>
                      <span aria-hidden className="text-zinc-600">→</span>
                      <span className="text-zinc-400">Sauvegarde : <span className="text-indigo-300">{formatValue(change.after)}</span></span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function RestoreModal({ guildId, snapshot, onClose, onDone }: {
  guildId: string;
  snapshot: ConfigSnapshotSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<BackupModuleId[]>(snapshot.modules);
  const toggle = (m: BackupModuleId) => setSelected((cur) => cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]);

  const restore = useMutation({
    mutationFn: () => api<RestoreResult>(`/api/guilds/${guildId}/config-snapshots/${snapshot.id}/restore`, { method: "POST", body: JSON.stringify({ modules: selected }) }),
    onSuccess: () => { toast.success("Configuration restaurée."); onDone(); },
    onError: () => toast.error("Restauration impossible."),
  });

  return (
    <Modal open onClose={onClose} title="Restaurer cette sauvegarde" locked={restore.isPending}>
      <p className="text-sm text-zinc-400">
        L'état actuel des modules choisis sera d'abord sauvegardé automatiquement, puis remplacé. Choisissez ce qui doit
        être restauré :
      </p>
      <div className="mt-3 space-y-2">
        {snapshot.modules.map((m) => (
          <label key={m} className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm">
            <input type="checkbox" checked={selected.includes(m)} onChange={() => toggle(m)} className="accent-indigo-500" />
            {BACKUP_MODULE_LABELS[m]}
          </label>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={restore.isPending}>Annuler</Button>
        <Button disabled={selected.length === 0} loading={restore.isPending} onClick={() => restore.mutate()}>Restaurer</Button>
      </div>
    </Modal>
  );
}
