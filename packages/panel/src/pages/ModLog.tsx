import { useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModActionDto, Paginated, WarningDto } from "@bot/shared";
import { api } from "../lib/api.js";

const ACTION_LABELS: Record<string, string> = {
  ban: "🔨 Ban",
  unban: "✅ Unban",
  kick: "👢 Kick",
  timeout: "🔇 Timeout",
  auto_timeout: "🔇 Timeout auto",
  warn: "⚠️ Warn",
  unwarn: "↩️ Warn révoqué",
  clear: "🧹 Clear",
};

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

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Actions de modération</h2>
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
        >
          <option value="">Toutes les actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {actions.data?.items.length === 0 && <p className="text-sm text-zinc-500">Aucune action enregistrée.</p>}

      <ul className="space-y-1.5">
        {actions.data?.items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-950 px-3 py-2 text-sm">
            <span className="w-32 shrink-0">{ACTION_LABELS[a.action] ?? a.action}</span>
            {a.targetId && <code className="text-zinc-400">{a.targetId}</code>}
            <span className="text-zinc-500">
              par {a.moderatorId === "system" ? "🤖 système" : <code>{a.moderatorId}</code>}
            </span>
            {a.reason && <span className="text-zinc-400">— {a.reason}</span>}
            <span className="ml-auto text-xs text-zinc-600">
              #{a.id} · {a.createdAt} UTC {a.source !== "interaction" && `· ${a.source}`}
            </span>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-zinc-700 px-3 py-1 disabled:opacity-40"
          >
            ←
          </button>
          <span className="text-zinc-400">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-zinc-700 px-3 py-1 disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}
    </section>
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

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-semibold">Avertissements</h2>
        <input
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value.trim())}
          placeholder="Filtrer par ID utilisateur"
          className="w-64 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm"
        />
      </div>

      {warnings.data?.length === 0 && <p className="text-sm text-zinc-500">Aucun avertissement.</p>}

      <ul className="space-y-1.5">
        {warnings.data?.map((w) => (
          <li
            key={w.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-950 px-3 py-2 text-sm ${w.revokedAt ? "opacity-50" : ""}`}
          >
            <span className="text-zinc-500">#{w.id}</span>
            <code className="text-zinc-300">{w.userId}</code>
            <span className="text-zinc-400">{w.reason ?? "(sans raison)"}</span>
            <span className="text-xs text-zinc-600">
              par {w.moderatorId} · {w.createdAt} UTC
            </span>
            {w.revokedAt ? (
              <span className="ml-auto text-xs text-zinc-500">révoqué par {w.revokedBy}</span>
            ) : (
              <button
                onClick={() => revoke.mutate(w.id)}
                disabled={revoke.isPending}
                className="ml-auto rounded-md border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-800"
              >
                Révoquer
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ModLogPage() {
  return (
    <div className="space-y-6">
      <ModActions />
      <Warnings />
    </div>
  );
}
