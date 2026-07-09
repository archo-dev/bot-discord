import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PanelAccessEntry, RoleOption } from "@bot/shared";
import { api, ApiError } from "../lib/api.js";

export function PanelAccessPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const entries = useQuery({
    queryKey: ["panel-access", guildId],
    queryFn: () => api<PanelAccessEntry[]>(`/api/guilds/${guildId}/panel-access`),
    retry: false,
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
  });

  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [newUserId, setNewUserId] = useState("");

  useEffect(() => {
    if (entries.data) {
      setSelectedRoles(entries.data.filter((e) => e.subjectType === "role").map((e) => e.subjectId));
      setUserIds(entries.data.filter((e) => e.subjectType === "user").map((e) => e.subjectId));
    }
  }, [entries.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/api/guilds/${guildId}/panel-access`, {
        method: "PUT",
        body: JSON.stringify([
          ...selectedRoles.map((id) => ({ subjectType: "role", subjectId: id })),
          ...userIds.map((id) => ({ subjectType: "user", subjectId: id })),
        ]),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["panel-access", guildId] }),
  });

  if (entries.isError && entries.error instanceof ApiError && entries.error.status === 403) {
    return (
      <p className="text-zinc-400">
        Seuls les membres avec la permission « Gérer le serveur » peuvent configurer l'accès au panel.
      </p>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Rôles autorisés</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Les membres de ces rôles peuvent utiliser le panel même sans la permission « Gérer le serveur ».
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {roles.data
            ?.filter((r) => !r.managed)
            .map((r) => {
              const selected = selectedRoles.includes(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() =>
                    setSelectedRoles((prev) => (selected ? prev.filter((id) => id !== r.id) : [...prev, r.id]))
                  }
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    selected
                      ? "border-indigo-500 bg-indigo-950 text-indigo-200"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  {r.name}
                </button>
              );
            })}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Utilisateurs autorisés (par ID)</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            placeholder="ID utilisateur Discord"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <button
            onClick={() => {
              if (/^\d{5,20}$/.test(newUserId) && !userIds.includes(newUserId)) {
                setUserIds((prev) => [...prev, newUserId]);
                setNewUserId("");
              }
            }}
            className="rounded-lg border border-zinc-700 px-4 text-sm hover:bg-zinc-800"
          >
            Ajouter
          </button>
        </div>
        <ul className="mt-3 space-y-1">
          {userIds.map((id) => (
            <li key={id} className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2 text-sm">
              <code>{id}</code>
              <button
                onClick={() => setUserIds((prev) => prev.filter((u) => u !== id))}
                className="text-zinc-500 hover:text-red-400"
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {save.isSuccess && <span className="text-sm text-green-400">✓ Enregistré</span>}
        {save.isError && <span className="text-sm text-red-400">Échec (permission « Gérer le serveur » requise)</span>}
      </div>
    </div>
  );
}
