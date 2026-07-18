import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeaderboardEntry, RoleOption, XpSettingsDto } from "@bot/shared";
import { api, fieldError } from "../lib/api.js";
import { Button, Card, EmptyState, Field, IconButton, InfoCard, Input, Toggle } from "../ui/kit.js";
import { ChannelSelect, RoleSelect } from "../ui/entity-select.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

export function LevelsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const settings = useQuery({
    queryKey: ["xp-settings", guildId],
    queryFn: () => api<XpSettingsDto>(`/api/guilds/${guildId}/xp-settings`),
  });
  const leaderboard = useQuery({
    queryKey: ["leaderboard", guildId],
    queryFn: () => api<LeaderboardEntry[]>(`/api/guilds/${guildId}/leaderboard`),
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
    meta: { silentError: true },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["xp-settings", guildId] }),
  });

  const dirty = useDirty(s, settings.data);
  const resetForm = () => settings.data && setS(settings.data);

  if (settings.isPending || !s) return <SkeletonSettingsPage cards={2} />;

  const set = (patch: Partial<XpSettingsDto>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));
  const assignableRoles = roles.data?.filter((r) => !r.managed) ?? [];

  return (
    // fieldset disabled (M15) : neutralise tous les champs pour les accès lecture seule.
    <fieldset disabled={!canWrite} className="space-y-4">
      {/* M21 : réglages en masonry 2 colonnes ; le classement (table) reste pleine largeur en dessous. */}
      <div className="columns-1 gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-title font-semibold text-zinc-100">XP par message</h2>
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span>Activé</span>
            <Toggle checked={s.enabled} onChange={(v) => set({ enabled: v })} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="XP min" error={fieldError(save.error, "xpMin")}>
            <Input
              type="number"
              min={1}
              max={100}
              value={s.xpMin}
              onChange={(e) => set({ xpMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="XP max" error={fieldError(save.error, "xpMax")}>
            <Input
              type="number"
              min={1}
              max={200}
              value={s.xpMax}
              onChange={(e) => set({ xpMax: Number(e.target.value) })}
            />
          </Field>
          <Field label="Cooldown (s)" error={fieldError(save.error, "cooldownSeconds")}>
            <Input
              type="number"
              min={5}
              max={3600}
              value={s.cooldownSeconds}
              onChange={(e) => set({ cooldownSeconds: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-300">
          <Toggle checked={s.announceLevelUp} onChange={(v) => set({ announceLevelUp: v })} />
          <span>Annoncer les passages de niveau</span>
        </div>
        {s.announceLevelUp && (
          <Field label="Salon des annonces">
            <ChannelSelect
              guildId={guildId!}
              value={s.announceChannelId}
              onChange={(id) => set({ announceChannelId: id })}
              placeholder="— Salon du message —"
            />
          </Field>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-title font-semibold text-zinc-100">XP vocal</h2>
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span>Activé</span>
            <Toggle checked={s.voiceEnabled} onChange={(v) => set({ voiceEnabled: v })} />
          </div>
        </div>
        <p className="text-sm text-zinc-400">
          Gagne de l'XP par minute passée en vocal. Exclus : bots, membres seuls dans le salon, en sourdine ou muet, et le
          salon AFK. Utilise la même courbe et les mêmes rôles récompense que l'XP par message.
        </p>
        <div className="sm:max-w-xs">
          <Field label="XP par minute" error={fieldError(save.error, "voiceXpPerMin")}>
          <Input
            type="number"
            min={1}
            max={100}
            value={s.voiceXpPerMin}
            onChange={(e) => set({ voiceXpPerMin: Number(e.target.value) })}
          />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-title font-semibold text-zinc-100">Rôles récompense</h2>
        <p className="mt-1 text-sm text-zinc-400">Attribués automatiquement quand le niveau est atteint.</p>
        <div className="mt-3 space-y-2">
          {s.rewards.map((reward, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Niveau</span>
              <Input
                type="number"
                min={1}
                max={200}
                value={reward.level}
                onChange={(e) =>
                  set({ rewards: s.rewards.map((r, j) => (j === i ? { ...r, level: Number(e.target.value) } : r)) })
                }
                className="w-20"
              />
              <span className="text-sm text-zinc-400">→</span>
              <div className="flex-1">
                <RoleSelect
                  guildId={guildId!}
                  value={reward.roleId}
                  onChange={(id) =>
                    set({ rewards: s.rewards.map((r, j) => (j === i ? { ...r, roleId: id ?? "" } : r)) })
                  }
                  excludeManaged
                  clearable={false}
                />
              </div>
              <IconButton label="Retirer cette récompense" danger onClick={() => set({ rewards: s.rewards.filter((_, j) => j !== i) })}>
                ✕
              </IconButton>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              const first = assignableRoles[0];
              if (first) set({ rewards: [...s.rewards, { level: 5, roleId: first.id }] });
            }}
            disabled={s.rewards.length >= 25 || assignableRoles.length === 0}
          >
            + Ajouter une récompense
          </Button>
        </div>
      </Card>
      </div>

      <Card>
        <h2 className="text-title font-semibold text-zinc-100">Classement</h2>
        {leaderboard.data && leaderboard.data.length > 0 ? (
          <div className="-mx-5 mt-3 overflow-x-auto px-5">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-semibold">#</th>
                  <th className="py-2 pr-4 font-semibold">Membre</th>
                  <th className="py-2 pr-4 font-semibold">Niveau</th>
                  <th className="py-2 pr-4 font-semibold">XP</th>
                  <th className="py-2 pr-4 text-right font-semibold">Messages</th>
                  <th className="py-2 text-right font-semibold">Vocal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-zinc-300">
                {leaderboard.data.slice(0, 20).map((e) => (
                  <tr key={e.userId}>
                    <td className="py-2.5 pr-4 text-zinc-500">{e.rank}</td>
                    <td className="py-2.5 pr-4 font-medium text-zinc-100">{e.username ?? e.userId}</td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-semibold text-indigo-200">
                        Niv. {e.level}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">{e.xp}</td>
                    <td className="py-2.5 pr-4 text-right">{e.messages}</td>
                    <td className="py-2.5 text-right text-zinc-400">{e.voiceMinutes} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Icon.trophy />}
            title="Personne n'a encore gagné d'XP"
            description="Le classement se remplit dès que les membres écrivent des messages (le gain d'XP nécessite le service Gateway)."
          />
        )}
      </Card>

      <InfoCard icon={<Icon.trophy />} title="Bon à savoir">
        Les rôles récompense sont rattrapés : un membre reçoit tous les rôles jusqu'à son niveau actuel, pas seulement
        le dernier. Le gain d'XP nécessite le service Gateway.
      </InfoCard>

      <SaveBar
        dirty={dirty}
        status={save.isPending ? "pending" : save.isError ? "error" : save.isSuccess ? "success" : "idle"}
        onSave={() => save.mutate()}
        onReset={resetForm}
      />
    </fieldset>
  );
}
