import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelOption, LeaderboardEntry, RoleOption, XpSettingsDto } from "@bot/shared";
import { api } from "../lib/api.js";

export function LevelsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["xp-settings", guildId],
    queryFn: () => api<XpSettingsDto>(`/api/guilds/${guildId}/xp-settings`),
  });
  const leaderboard = useQuery({
    queryKey: ["leaderboard", guildId],
    queryFn: () => api<LeaderboardEntry[]>(`/api/guilds/${guildId}/leaderboard`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
  });

  const [s, setS] = useState<XpSettingsDto | null>(null);

  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!s) return;
      await api(`/api/guilds/${guildId}/xp-settings`, { method: "PUT", body: JSON.stringify(s) });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["xp-settings", guildId] }),
  });

  if (settings.isPending || !s) return <p className="text-zinc-400">Chargement…</p>;

  const set = (patch: Partial<XpSettingsDto>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));
  const assignableRoles = roles.data?.filter((r) => !r.managed) ?? [];

  return (
    <div className="max-w-2xl space-y-8">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">XP par message</h2>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Activé
          </label>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <label className="text-sm text-zinc-300">
            XP min
            <input
              type="number"
              min={1}
              max={100}
              value={s.xpMin}
              onChange={(e) => set({ xpMin: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm text-zinc-300">
            XP max
            <input
              type="number"
              min={1}
              max={200}
              value={s.xpMax}
              onChange={(e) => set({ xpMax: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Cooldown (s)
            <input
              type="number"
              min={5}
              max={3600}
              value={s.cooldownSeconds}
              onChange={(e) => set({ cooldownSeconds: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={s.announceLevelUp}
            onChange={(e) => set({ announceLevelUp: e.target.checked })}
          />
          Annoncer les passages de niveau
        </label>
        {s.announceLevelUp && (
          <label className="block text-sm text-zinc-300">
            Salon des annonces
            <select
              value={s.announceChannelId ?? ""}
              onChange={(e) => set({ announceChannelId: e.target.value || null })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="">— Salon du message —</option>
              {channels.data
                ?.filter((ch) => ch.type !== 4)
                .map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    #{ch.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Rôles récompense</h2>
        <p className="mt-1 text-sm text-zinc-400">Attribués automatiquement quand le niveau est atteint.</p>
        <div className="mt-3 space-y-2">
          {s.rewards.map((reward, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Niveau</span>
              <input
                type="number"
                min={1}
                max={200}
                value={reward.level}
                onChange={(e) =>
                  set({ rewards: s.rewards.map((r, j) => (j === i ? { ...r, level: Number(e.target.value) } : r)) })
                }
                className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <span className="text-sm text-zinc-400">→</span>
              <select
                value={reward.roleId}
                onChange={(e) =>
                  set({ rewards: s.rewards.map((r, j) => (j === i ? { ...r, roleId: e.target.value } : r)) })
                }
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              >
                {assignableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => set({ rewards: s.rewards.filter((_, j) => j !== i) })}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:border-red-500 hover:text-red-300"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const first = assignableRoles[0];
              if (first) set({ rewards: [...s.rewards, { level: 5, roleId: first.id }] });
            }}
            disabled={s.rewards.length >= 25 || assignableRoles.length === 0}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-indigo-500 disabled:opacity-50"
          >
            + Ajouter une récompense
          </button>
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

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Classement</h2>
        {leaderboard.data && leaderboard.data.length > 0 ? (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-1 pr-4">#</th>
                <th className="py-1 pr-4">Membre</th>
                <th className="py-1 pr-4">Niveau</th>
                <th className="py-1 pr-4">XP</th>
                <th className="py-1">Messages</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {leaderboard.data.slice(0, 20).map((e) => (
                <tr key={e.userId} className="border-t border-zinc-800">
                  <td className="py-1.5 pr-4 text-zinc-500">{e.rank}</td>
                  <td className="py-1.5 pr-4">{e.username ?? e.userId}</td>
                  <td className="py-1.5 pr-4">{e.level}</td>
                  <td className="py-1.5 pr-4">{e.xp}</td>
                  <td className="py-1.5">{e.messages}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">Personne n'a encore gagné d'XP.</p>
        )}
      </section>
    </div>
  );
}
