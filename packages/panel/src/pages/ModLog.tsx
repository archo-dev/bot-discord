import { useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModActionDto, Paginated, WarningDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, Button, Card, EmptyState, ErrorCard, InfoCard, Pagination, Tabs, TableWrap } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { SkeletonList } from "../ui/skeleton.js";
import { UserCell } from "../ui/cells.js";
import { MemberCombobox } from "../ui/entity-select.js";
import { ConfirmModal } from "../ui/overlay.js";
import { actionMeta, ModActionIcon, TimeAgo } from "../ui/mod-meta.js";
import { useCanWrite } from "../lib/access.js";

const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Toutes les actions" },
  { value: "ban", label: "Ban" },
  { value: "unban", label: "Unban" },
  { value: "kick", label: "Kick" },
  { value: "timeout", label: "Mute" },
  { value: "auto_timeout", label: "Mute auto" },
  { value: "warn", label: "Warn" },
  { value: "unwarn", label: "Warn révoqué" },
  { value: "clear", label: "Clear" },
];

function ModActions() {
  const { guildId } = useParams<{ guildId: string }>();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");

  const actions = useQuery({
    queryKey: ["mod-actions", guildId, page, actionFilter],
    queryFn: () =>
      api<Paginated<ModActionDto>>(
        `/api/guilds/${guildId}/mod-actions?page=${page}${actionFilter ? `&action=${actionFilter}` : ""}`,
      ),
  });

  const totalPages = actions.data ? Math.max(Math.ceil(actions.data.total / actions.data.pageSize), 1) : 1;
  const items = actions.data?.items ?? [];

  return (
    <Card
      title="Actions récentes"
      action={
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100"
        >
          {ACTION_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      }
    >
      {actions.isPending ? (
        <SkeletonList rows={6} />
      ) : actions.isError ? (
        <ErrorCard message="Impossible de charger les actions de modération." onRetry={() => void actions.refetch()} />
      ) : items.length === 0 ? (
        actionFilter ? (
          <EmptyState
            icon={<Icon.scroll />}
            title="Aucun résultat pour ce filtre"
            description={`Aucune action « ${ACTION_FILTERS.find((f) => f.value === actionFilter)?.label ?? actionFilter} » enregistrée.`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setActionFilter("")}>
                Effacer le filtre
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon.scroll />}
            title="Aucune action pour le moment"
            description="Les actions de modération apparaîtront ici dès le premier /warn, /mute ou /ban."
          />
        )
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-2 pr-4 font-semibold">Action</th>
              <th className="py-2 pr-4 font-semibold">Utilisateur</th>
              <th className="py-2 pr-4 font-semibold">Modéré par</th>
              <th className="py-2 pr-4 font-semibold">Raison</th>
              <th className="py-2 pr-4 text-right font-semibold">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((a) => (
              <tr key={a.id} className="align-middle">
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-2.5">
                    <ModActionIcon action={a.action} size={30} />
                    <span className="font-semibold text-zinc-100">{actionMeta(a.action).label}</span>
                  </div>
                </td>
                <td className="py-2.5 pr-4">
                  {a.targetId ? <UserCell userId={a.targetId} /> : <span className="text-zinc-600">—</span>}
                </td>
                <td className="py-2.5 pr-4">
                  <UserCell userId={a.moderatorId} />
                </td>
                <td className="max-w-[16rem] truncate py-2.5 pr-4 text-zinc-400" title={a.reason ?? undefined}>
                  {a.reason ?? "—"}
                </td>
                <td className="whitespace-nowrap py-2.5 pr-4 text-right text-zinc-500">
                  <TimeAgo iso={a.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Pagination page={page} totalPages={totalPages} total={actions.data?.total} onPage={setPage} />
    </Card>
  );
}

function Warnings() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [userFilter, setUserFilter] = useState("");
  const [toRevoke, setToRevoke] = useState<WarningDto | null>(null);

  const warnings = useQuery({
    queryKey: ["warnings", guildId, userFilter],
    queryFn: () => api<WarningDto[]>(`/api/guilds/${guildId}/warnings${userFilter ? `?userId=${userFilter}` : ""}`),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => api(`/api/guilds/${guildId}/warnings/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Avertissement révoqué" },
    onSuccess: () => {
      setToRevoke(null);
      void queryClient.invalidateQueries({ queryKey: ["warnings", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["mod-actions", guildId] });
    },
  });

  const items = warnings.data ?? [];

  return (
    <Card
      title="Avertissements"
      action={
        <div className="w-56 sm:w-64">
          <MemberCombobox
            guildId={guildId!}
            value={userFilter || null}
            onChange={(id) => setUserFilter(id ?? "")}
            placeholder="Filtrer par membre…"
          />
        </div>
      }
    >
      {warnings.isPending ? (
        <SkeletonList rows={4} />
      ) : warnings.isError ? (
        <ErrorCard message="Impossible de charger les avertissements." onRetry={() => void warnings.refetch()} />
      ) : items.length === 0 ? (
        userFilter ? (
          <EmptyState
            icon={<Icon.shield />}
            title="Aucun avertissement pour cet utilisateur"
            action={
              <Button variant="secondary" size="sm" onClick={() => setUserFilter("")}>
                Effacer le filtre
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon.shield />}
            title="Aucun avertissement"
            description="Les avertissements donnés avec /warn apparaîtront ici, avec leur statut actif ou révoqué."
          />
        )
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-2 pr-4 font-semibold">#</th>
              <th className="py-2 pr-4 font-semibold">Utilisateur</th>
              <th className="py-2 pr-4 font-semibold">Raison</th>
              <th className="py-2 pr-4 font-semibold">Par</th>
              <th className="py-2 pr-4 font-semibold">Date</th>
              <th className="py-2 pr-4 text-right font-semibold">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((w) => (
              <tr key={w.id} className={w.revokedAt ? "opacity-50" : ""}>
                <td className="py-2.5 pr-4 text-zinc-500">#{w.id}</td>
                <td className="py-2.5 pr-4">
                  <UserCell userId={w.userId} />
                </td>
                <td className="max-w-[16rem] truncate py-2.5 pr-4 text-zinc-400" title={w.reason ?? undefined}>
                  {w.reason ?? "(sans raison)"}
                </td>
                <td className="py-2.5 pr-4">
                  <UserCell userId={w.moderatorId} />
                </td>
                <td className="whitespace-nowrap py-2.5 pr-4 text-zinc-500">
                  <TimeAgo iso={w.createdAt} />
                </td>
                <td className="py-2.5 pr-4 text-right">
                  {w.revokedAt ? (
                    <Badge tone="neutral">Révoqué</Badge>
                  ) : canWrite ? (
                    <Button size="sm" variant="secondary" onClick={() => setToRevoke(w)}>
                      Révoquer
                    </Button>
                  ) : (
                    <Badge tone="success">Actif</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <ConfirmModal
        open={toRevoke !== null}
        title="Révoquer cet avertissement ?"
        subject={
          <>
            L'avertissement <b className="text-zinc-100">#{toRevoke?.id}</b> sera retiré du décompte actif de
            l'utilisateur.
          </>
        }
        consequence="La révocation est enregistrée dans le mod-log et ne peut pas être annulée."
        confirmLabel="Révoquer"
        loading={revoke.isPending}
        onCancel={() => setToRevoke(null)}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)}
      />
    </Card>
  );
}

export function ModLogPage() {
  const [tab, setTab] = useState<"actions" | "warnings">("actions");
  return (
    // M21 : largeur bornée — une table 5 colonnes s'étale et paraît vide sur 1600 px.
    <div className="max-w-7xl space-y-5">
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "actions", label: "Actions de modération" },
          { id: "warnings", label: "Avertissements" },
        ]}
      />
      {tab === "actions" ? <ModActions /> : <Warnings />}
      <InfoCard icon={<Icon.shield />} title="Bon à savoir">
        Les avertissements alimentent le seuil de warns → mute automatique (réglable dans la Configuration). Révoquer un
        warn le retire du décompte actif.
      </InfoCard>
    </div>
  );
}
