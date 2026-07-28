import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeaderboardEntry, RoleOption, XpSettingsDto } from "@bot/shared";
import { api, fieldError } from "../lib/api.js";
import { Button, Card, ErrorCard, Field, IconButton, InfoCard, Input, OperationalState, Toggle } from "../ui/kit.js";
import { ChannelSelect, RoleSelect } from "../ui/entity-select.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonList, SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";
import { AsyncState } from "../ui/async-state.js";
import type { GuildOutletContext } from "./GuildLayout.js";

export function LevelsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const { availability } = useOutletContext<GuildOutletContext>();

  const settings = useQuery({
    queryKey: ["xp-settings", guildId],
    queryFn: ({ signal }) => api<XpSettingsDto>(`/api/guilds/${guildId}/xp-settings`, { signal }),
  });
  const leaderboard = useQuery({
    queryKey: ["leaderboard", guildId],
    queryFn: ({ signal }) => api<LeaderboardEntry[]>(`/api/guilds/${guildId}/leaderboard`, { signal }),
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: ({ signal }) => api<RoleOption[]>(`/api/guilds/${guildId}/roles`, { signal }),
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

  if (settings.isPending) return <SkeletonSettingsPage cards={2} />;
  if (settings.isError) {
    return (
      <ErrorCard
        message="Impossible de charger les réglages de niveaux. Vous pouvez continuer à consulter les autres sections."
        onRetry={() => void settings.refetch()}
        retrying={settings.isFetching}
      />
    );
  }
  if (!s) return <SkeletonSettingsPage cards={2} />;

  const set = (patch: Partial<XpSettingsDto>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));
  const assignableRoles = roles.data?.filter((r) => !r.managed) ?? [];

  return (
    <div className="space-y-4">
      {!canWrite && (
        <OperationalState
          kind="readonly"
          title="Consultation en lecture seule"
          description="Votre rôle panel autorise la consultation des niveaux, mais pas leur modification."
          impact="Les réglages et la sauvegarde sont désactivés."
          available="Le classement et les récompenses actuelles restent consultables."
        />
      )}
      {!availability.gatewayConnected && (
        <OperationalState
          kind="gateway"
          title="Collecte XP interrompue"
          description="La Gateway est hors ligne. Aucun nouvel XP message ou vocal n’est collecté pendant cette interruption."
          impact="Le classement ne progresse plus temporairement."
          available="La configuration peut toujours être modifiée et enregistrée."
        />
      )}
      {roles.isError && (
        <ErrorCard
          compact
          title="Rôles de récompense indisponibles"
          message="Impossible de charger les rôles Discord. Les autres réglages restent utilisables."
          onRetry={() => void roles.refetch()}
          retrying={roles.isFetching}
        />
      )}
      {/* fieldset disabled (M15) : neutralise tous les champs pour les accès lecture seule. */}
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
              ariaLabel="Salon des annonces de niveau"
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
            <div key={i} className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-400">Niveau</span>
              <Input
                aria-label={`Niveau de la récompense ${i + 1}`}
                type="number"
                min={1}
                max={200}
                value={reward.level}
                onChange={(e) =>
                  set({ rewards: s.rewards.map((r, j) => (j === i ? { ...r, level: Number(e.target.value) } : r)) })
                }
                className="w-20"
              />
              <span className="hidden text-sm text-zinc-400 sm:inline">→</span>
              <div className="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-auto">
                <RoleSelect
                  guildId={guildId!}
                  value={reward.roleId}
                  ariaLabel={`Rôle attribué par la récompense ${i + 1}`}
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
        <AsyncState
          pending={leaderboard.isPending}
          error={leaderboard.error}
          empty={(leaderboard.data?.length ?? 0) === 0}
          loading={<SkeletonList rows={5} />}
          errorMessage="Impossible de charger le classement. Les réglages restent disponibles."
          onRetry={() => void leaderboard.refetch()}
          retrying={leaderboard.isFetching}
          emptyIcon={<Icon.trophy />}
          emptyTitle="Personne n'a encore gagné d'XP"
          emptyDescription="Le classement se remplit dès que les membres écrivent ou participent en vocal. La collecte nécessite la Gateway."
        >
          <div className="mt-3 hidden overflow-x-auto md:block">
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
                {leaderboard.data!.slice(0, 20).map((e) => (
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
          <ul className="mt-3 space-y-2 md:hidden" aria-label="Classement des membres">
            {leaderboard.data!.slice(0, 20).map((entry) => (
              <li
                key={entry.userId}
                data-mobile-card
                className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/35 p-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-sm font-bold text-indigo-200">
                    {entry.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold text-zinc-100">{entry.username ?? entry.userId}</p>
                    <p className="mt-0.5 break-all text-xs text-zinc-500">{entry.userId}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-semibold text-indigo-200">
                    Niv. {entry.level}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-zinc-900/75 p-2">
                    <dt className="text-zinc-500">XP</dt>
                    <dd className="mt-0.5 font-semibold text-zinc-200">{entry.xp}</dd>
                  </div>
                  <div className="rounded-lg bg-zinc-900/75 p-2">
                    <dt className="text-zinc-500">Messages</dt>
                    <dd className="mt-0.5 font-semibold text-zinc-200">{entry.messages}</dd>
                  </div>
                  <div className="col-span-2 rounded-lg bg-zinc-900/75 p-2">
                    <dt className="text-zinc-500">Activité vocale</dt>
                    <dd className="mt-0.5 font-semibold text-zinc-200">{entry.voiceMinutes} min</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </AsyncState>
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
        errorMessage="Échec de l’enregistrement. Le brouillon est conservé ; vérifiez votre connexion et réessayez."
        showWhenClean={!canWrite}
      />
      </fieldset>
    </div>
  );
}
