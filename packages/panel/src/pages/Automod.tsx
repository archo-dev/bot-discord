import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutomodSettingsDto, ChannelOption, RoleOption } from "@bot/shared";
import { api } from "../lib/api.js";

const ACTIONS = [
  { value: "delete", label: "Supprimer le message seulement" },
  { value: "warn", label: "Supprimer + avertissement (compte pour le seuil de warns)" },
  { value: "timeout", label: "Supprimer + mute temporaire" },
] as const;

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

export function AutomodPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["automod", guildId],
    queryFn: () => api<AutomodSettingsDto>(`/api/guilds/${guildId}/automod`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
  });

  const [s, setS] = useState<AutomodSettingsDto | null>(null);
  const [whitelistText, setWhitelistText] = useState("");
  const [wordsText, setWordsText] = useState("");

  useEffect(() => {
    if (settings.data) {
      setS(settings.data);
      setWhitelistText(settings.data.linkWhitelist.join("\n"));
      setWordsText(settings.data.bannedWords.join("\n"));
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!s) return;
      await api(`/api/guilds/${guildId}/automod`, {
        method: "PUT",
        body: JSON.stringify({
          ...s,
          linkWhitelist: whitelistText
            .split("\n")
            .map((l) => l.trim().toLowerCase())
            .filter(Boolean),
          bannedWords: wordsText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        }),
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["automod", guildId] }),
  });

  if (settings.isPending || !s) return <p className="text-zinc-400">Chargement…</p>;

  const set = (patch: Partial<AutomodSettingsDto>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <div className="max-w-2xl space-y-8">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Sanction</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Appliquée à chaque infraction. Les avertissements alimentent le seuil warns → mute auto de la Configuration.
          Les membres avec « Gérer les messages » sont toujours exemptés.
        </p>
        <select
          value={s.action}
          onChange={(e) => set({ action: e.target.value as AutomodSettingsDto["action"] })}
          className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        >
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        {s.action === "timeout" && (
          <label className="mt-3 block text-sm text-zinc-300">
            Durée du mute (minutes)
            <input
              type="number"
              min={1}
              max={40320}
              value={s.timeoutMinutes}
              onChange={(e) => set({ timeoutMinutes: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
        <h2 className="font-semibold">Anti-spam</h2>
        <Toggle checked={s.antiSpamEnabled} onChange={(v) => set({ antiSpamEnabled: v })} label="Activé" />
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm text-zinc-300">
            Messages max
            <input
              type="number"
              min={2}
              max={20}
              value={s.antiSpamMaxMessages}
              onChange={(e) => set({ antiSpamMaxMessages: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Fenêtre (secondes)
            <input
              type="number"
              min={2}
              max={60}
              value={s.antiSpamWindowSeconds}
              onChange={(e) => set({ antiSpamWindowSeconds: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          Ex. : plus de {s.antiSpamMaxMessages} messages en {s.antiSpamWindowSeconds} s → sanction.
        </p>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
        <h2 className="font-semibold">Invitations & liens</h2>
        <Toggle checked={s.antiInviteEnabled} onChange={(v) => set({ antiInviteEnabled: v })} label="Bloquer les invitations Discord" />
        <Toggle checked={s.antiLinkEnabled} onChange={(v) => set({ antiLinkEnabled: v })} label="Bloquer les liens" />
        {s.antiLinkEnabled && (
          <label className="block text-sm text-zinc-300">
            Domaines autorisés (un par ligne, sous-domaines inclus)
            <textarea
              value={whitelistText}
              onChange={(e) => setWhitelistText(e.target.value)}
              rows={3}
              placeholder={"youtube.com\ntwitch.tv"}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono"
            />
          </label>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Mots interdits</h2>
        <p className="mt-1 text-sm text-zinc-400">Un mot ou une expression par ligne (insensible à la casse).</p>
        <textarea
          value={wordsText}
          onChange={(e) => setWordsText(e.target.value)}
          rows={4}
          className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono"
        />
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
        <h2 className="font-semibold">Exemptions</h2>
        <div>
          <p className="text-sm text-zinc-400">Rôles exemptés</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {roles.data
              ?.filter((r) => !r.managed)
              .map((r) => {
                const selected = s.exemptRoleIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() =>
                      set({
                        exemptRoleIds: selected ? s.exemptRoleIds.filter((id) => id !== r.id) : [...s.exemptRoleIds, r.id],
                      })
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
        </div>
        <div>
          <p className="text-sm text-zinc-400">Salons exemptés</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {channels.data
              ?.filter((ch) => ch.type !== 4)
              .map((ch) => {
                const selected = s.exemptChannelIds.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    onClick={() =>
                      set({
                        exemptChannelIds: selected
                          ? s.exemptChannelIds.filter((id) => id !== ch.id)
                          : [...s.exemptChannelIds, ch.id],
                      })
                    }
                    className={`rounded-full border px-3 py-1 text-sm transition ${
                      selected
                        ? "border-indigo-500 bg-indigo-950 text-indigo-200"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    #{ch.name}
                  </button>
                );
              })}
          </div>
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
