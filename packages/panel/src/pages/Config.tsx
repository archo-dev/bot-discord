import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutoRoleEntry, ChannelOption, GuildOverview, RoleOption } from "@bot/shared";
import { api } from "../lib/api.js";

export function ConfigPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ["guild", guildId],
    queryFn: () => api<GuildOverview>(`/api/guilds/${guildId}`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
  });
  const autoRoles = useQuery({
    queryKey: ["auto-roles", guildId],
    queryFn: () => api<AutoRoleEntry[]>(`/api/guilds/${guildId}/auto-roles`),
  });

  const [logChannelId, setLogChannelId] = useState<string>("");
  const [warnThreshold, setWarnThreshold] = useState(3);
  const [warnTimeoutMinutes, setWarnTimeoutMinutes] = useState(60);
  const [selectedAutoRoles, setSelectedAutoRoles] = useState<string[]>([]);

  useEffect(() => {
    if (overview.data) {
      setLogChannelId(overview.data.logChannelId ?? "");
      setWarnThreshold(overview.data.warnThreshold);
      setWarnTimeoutMinutes(overview.data.warnTimeoutMinutes);
    }
  }, [overview.data]);

  useEffect(() => {
    if (autoRoles.data) setSelectedAutoRoles(autoRoles.data.map((r) => r.roleId));
  }, [autoRoles.data]);

  const save = useMutation({
    mutationFn: async () => {
      await api(`/api/guilds/${guildId}/config`, {
        method: "PATCH",
        body: JSON.stringify({
          logChannelId: logChannelId || null,
          warnThreshold,
          warnTimeoutMinutes,
        }),
      });
      await api(`/api/guilds/${guildId}/auto-roles`, {
        method: "PUT",
        body: JSON.stringify(selectedAutoRoles),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["guild", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["auto-roles", guildId] });
    },
  });

  if (overview.isPending) return <p className="text-zinc-400">Chargement…</p>;

  return (
    <div className="max-w-2xl space-y-8">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Logs de modération</h2>
        <p className="mt-1 text-sm text-zinc-400">Salon où le bot poste chaque action de modération.</p>
        <select
          value={logChannelId}
          onChange={(e) => setLogChannelId(e.target.value)}
          className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        >
          <option value="">— Désactivé —</option>
          {channels.data?.filter((ch) => ch.type !== 4).map((ch) => (
            <option key={ch.id} value={ch.id}>
              #{ch.name}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Avertissements</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Au bout de <b>{warnThreshold}</b> warns actifs, le membre est automatiquement mute{" "}
          <b>{warnTimeoutMinutes} min</b> (appliqué au moment du /warn).
        </p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <label className="text-sm text-zinc-300">
            Seuil de warns
            <input
              type="number"
              min={1}
              max={20}
              value={warnThreshold}
              onChange={(e) => setWarnThreshold(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Durée du mute auto (minutes)
            <input
              type="number"
              min={1}
              max={40320}
              value={warnTimeoutMinutes}
              onChange={(e) => setWarnTimeoutMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 opacity-90">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Rôles automatiques à l'arrivée</h2>
          <span className="rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300">Nécessite le Gateway</span>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Enregistré dès maintenant, appliqué automatiquement quand le service Gateway sera déployé.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {roles.data
            ?.filter((r) => !r.managed)
            .map((r) => {
              const selected = selectedAutoRoles.includes(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() =>
                    setSelectedAutoRoles((prev) => (selected ? prev.filter((id) => id !== r.id) : [...prev, r.id]))
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

      <div className="flex items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {save.isSuccess && <span className="text-sm text-green-400">✓ Enregistré</span>}
        {save.isError && <span className="text-sm text-red-400">Échec de l'enregistrement</span>}
      </div>
    </div>
  );
}
