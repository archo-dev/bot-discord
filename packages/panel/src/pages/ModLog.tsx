import { useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModActionDto, Paginated, WarningDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, Button, Card, InfoCard, Tabs, TableWrap } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { actionMeta, ModActionIcon, relativeTime } from "../ui/mod-meta.js";

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
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Aucune action enregistrée.</p>
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
                  {a.targetId ? <code className="text-zinc-300">{a.targetId}</code> : <span className="text-zinc-600">—</span>}
                </td>
                <td className="py-2.5 pr-4 text-zinc-400">
                  {a.moderatorId === "system" ? "🤖 système" : <code>{a.moderatorId}</code>}
                </td>
                <td className="max-w-[16rem] truncate py-2.5 pr-4 text-zinc-400">{a.reason ?? "—"}</td>
                <td className="whitespace-nowrap py-2.5 pr-4 text-right text-zinc-500">{relativeTime(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-zinc-700 px-3 py-1 disabled:opacity-40"
          >
            ←
          </button>
          <span className="text-zinc-400">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-zinc-700 px-3 py-1 disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}
    </Card>
  );
}

function Warnings() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const [userFilter, setUserFilter] = useState("");

  const warnings = useQuery({
    queryKey: ["warnings", guildId, userFilter],
    queryFn: () => api<WarningDto[]>(`/api/guilds/${guildId}/warnings${userFilter ? `?userId=${userFilter}` : ""}`),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => api(`/api/guilds/${guildId}/warnings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warnings", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["mod-actions", guildId] });
    },
  });

  const items = warnings.data ?? [];

  return (
    <Card
      title="Avertissements"
      action={
        <input
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value.trim())}
          placeholder="Filtrer par ID utilisateur"
          className="h-9 w-44 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 sm:w-64"
        />
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Aucun avertissement.</p>
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
                  <code className="text-zinc-300">{w.userId}</code>
                </td>
                <td className="max-w-[16rem] truncate py-2.5 pr-4 text-zinc-400">{w.reason ?? "(sans raison)"}</td>
                <td className="py-2.5 pr-4 text-zinc-400">
                  <code>{w.moderatorId}</code>
                </td>
                <td className="whitespace-nowrap py-2.5 pr-4 text-zinc-500">{relativeTime(w.createdAt)}</td>
                <td className="py-2.5 pr-4 text-right">
                  {w.revokedAt ? (
                    <Badge tone="neutral">Révoqué</Badge>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={revoke.isPending} onClick={() => revoke.mutate(w.id)}>
                      Révoquer
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

export function ModLogPage() {
  const [tab, setTab] = useState<"actions" | "warnings">("actions");
  return (
    <div className="space-y-5">
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
