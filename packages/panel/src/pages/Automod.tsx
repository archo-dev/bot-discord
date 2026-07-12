import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutomodSettingsDto, ChannelOption, RoleOption } from "@bot/shared";
import { api, fieldError } from "../lib/api.js";
import { Chip, InfoCard, Toggle } from "../ui/kit.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

const ACTIONS = [
  { value: "delete", label: "Supprimer le message seulement" },
  { value: "warn", label: "Supprimer + avertissement (compte pour le seuil de warns)" },
  { value: "timeout", label: "Supprimer + mute temporaire" },
] as const;

export function AutomodPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

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
    meta: { silentError: true },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["automod", guildId] }),
  });

  const initial = settings.data
    ? {
        s: settings.data,
        wl: settings.data.linkWhitelist.join("\n"),
        words: settings.data.bannedWords.join("\n"),
      }
    : undefined;
  const dirty = useDirty({ s, wl: whitelistText, words: wordsText }, initial);
  const resetForm = () => {
    if (!settings.data) return;
    setS(settings.data);
    setWhitelistText(settings.data.linkWhitelist.join("\n"));
    setWordsText(settings.data.bannedWords.join("\n"));
  };

  if (settings.isPending || !s) return <SkeletonSettingsPage cards={4} />;

  const set = (patch: Partial<AutomodSettingsDto>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    // fieldset disabled (M15) : neutralise tous les champs pour les accès lecture seule.
    <fieldset disabled={!canWrite} className="space-y-5">
      {/* M21 : masonry 2 colonnes (chaque colonne se remplit sans aligner les rangées → pas de vide entre cartes). */}
      <div className="columns-1 gap-5 xl:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
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
            {fieldError(save.error, "timeoutMinutes") && (
              <span className="mt-1 block text-xs text-red-400">{fieldError(save.error, "timeoutMinutes")}</span>
            )}
          </label>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
        <h2 className="font-semibold">Anti-spam</h2>
        <Toggle checked={s.antiSpamEnabled} onChange={(v) => set({ antiSpamEnabled: v })} label="Activé" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            {fieldError(save.error, "antiSpamMaxMessages") && (
              <span className="mt-1 block text-xs text-red-400">{fieldError(save.error, "antiSpamMaxMessages")}</span>
            )}
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
            {fieldError(save.error, "antiSpamWindowSeconds") && (
              <span className="mt-1 block text-xs text-red-400">{fieldError(save.error, "antiSpamWindowSeconds")}</span>
            )}
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
                  <Chip
                    key={r.id}
                    selected={selected}
                    onClick={() =>
                      set({
                        exemptRoleIds: selected ? s.exemptRoleIds.filter((id) => id !== r.id) : [...s.exemptRoleIds, r.id],
                      })
                    }
                  >
                    {r.name}
                  </Chip>
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
                  <Chip
                    key={ch.id}
                    selected={selected}
                    onClick={() =>
                      set({
                        exemptChannelIds: selected
                          ? s.exemptChannelIds.filter((id) => id !== ch.id)
                          : [...s.exemptChannelIds, ch.id],
                      })
                    }
                  >
                    #{ch.name}
                  </Chip>
                );
              })}
          </div>
        </div>
      </section>

      <InfoCard icon={<Icon.shield />} title="Bon à savoir">
        Les membres avec la permission « Gérer les messages » sont <b>toujours</b> exemptés de l'auto-modération, même
        sans règle d'exemption. L'auto-mod nécessite le service Gateway pour agir en temps réel.
      </InfoCard>
      </div>

      <SaveBar
        dirty={dirty}
        status={save.isPending ? "pending" : save.isError ? "error" : save.isSuccess ? "success" : "idle"}
        onSave={() => save.mutate()}
        onReset={resetForm}
      />
    </fieldset>
  );
}
