import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutoRoleEntry, GuildOverview, RoleOption } from "@bot/shared";
import { api, ApiError, fieldError } from "../lib/api.js";
import { Button, Card, Chip, Field, InfoCard, Input, Toggle } from "../ui/kit.js";
import { ChannelSelect } from "../ui/entity-select.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

export function ConfigPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const overview = useQuery({
    queryKey: ["guild", guildId],
    queryFn: () => api<GuildOverview>(`/api/guilds/${guildId}`),
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
  const [botNickname, setBotNickname] = useState("");
  const [mentionCards, setMentionCards] = useState(false);

  useEffect(() => {
    if (overview.data) {
      setLogChannelId(overview.data.logChannelId ?? "");
      setWarnThreshold(overview.data.warnThreshold);
      setWarnTimeoutMinutes(overview.data.warnTimeoutMinutes);
      setBotNickname(overview.data.customNickname ?? "");
      setMentionCards(overview.data.mentionCards);
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
          mentionCards,
        }),
      });
      await api(`/api/guilds/${guildId}/auto-roles`, {
        method: "PUT",
        body: JSON.stringify(selectedAutoRoles),
      });
    },
    // La SaveBar affiche l'échec : pas de toast global en doublon.
    meta: { silentError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["guild", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["auto-roles", guildId] });
    },
  });

  // Surnom du bot (M16) : appliqué immédiatement côté Discord, indépendant de la
  // SaveBar. Le 409 « missing_permission » signifie « enregistré mais non appliqué ».
  const saveNickname = useMutation({
    mutationFn: () =>
      api(`/api/guilds/${guildId}/nickname`, {
        method: "PATCH",
        body: JSON.stringify({ nickname: botNickname.trim() || null }),
      }),
    meta: { silentError: true },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["guild", guildId] }),
  });
  const nickMissingPerm = saveNickname.error instanceof ApiError && saveNickname.error.status === 409;

  // Dirty state : projection comparée à l'état serveur (D.S. v2 §4.9)
  const initial =
    overview.data && autoRoles.data
      ? {
          logChannelId: overview.data.logChannelId ?? "",
          warnThreshold: overview.data.warnThreshold,
          warnTimeoutMinutes: overview.data.warnTimeoutMinutes,
          mentionCards: overview.data.mentionCards,
          autoRoles: autoRoles.data.map((r) => r.roleId).sort(),
        }
      : undefined;
  const dirty = useDirty(
    { logChannelId, warnThreshold, warnTimeoutMinutes, mentionCards, autoRoles: [...selectedAutoRoles].sort() },
    initial,
  );
  const resetForm = () => {
    if (!initial) return;
    setLogChannelId(initial.logChannelId);
    setWarnThreshold(initial.warnThreshold);
    setWarnTimeoutMinutes(initial.warnTimeoutMinutes);
    setMentionCards(initial.mentionCards);
    setSelectedAutoRoles(autoRoles.data?.map((r) => r.roleId) ?? []);
  };

  if (overview.isPending) return <SkeletonSettingsPage cards={3} />;

  return (
    // fieldset disabled (M15) : neutralise tous les champs pour les accès lecture seule.
    <fieldset disabled={!canWrite} className="max-w-5xl space-y-3">
      <Card title="Configuration générale" description="Les réglages essentiels restent visibles ; les options occasionnelles sont repliées.">
        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-zinc-100">Logs de modération</h3>
            <p className="mb-2 mt-0.5 text-xs text-zinc-500">Salon où le bot poste chaque action.</p>
            <ChannelSelect
              guildId={guildId!}
              value={logChannelId || null}
              onChange={(id) => setLogChannelId(id ?? "")}
              placeholder="— Désactivé —"
            />
          </section>

          <section>
            <h3 className="text-sm font-semibold text-zinc-100">Avertissements</h3>
            <p className="mb-2 mt-0.5 text-xs text-zinc-500">Mute automatique après {warnThreshold} warns actifs.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Seuil" error={fieldError(save.error, "warnThreshold")}>
                <Input type="number" min={1} max={20} value={warnThreshold} onChange={(e) => setWarnThreshold(Number(e.target.value))} />
              </Field>
              <Field label="Mute (minutes)" error={fieldError(save.error, "warnTimeoutMinutes")}>
                <Input type="number" min={1} max={40320} value={warnTimeoutMinutes} onChange={(e) => setWarnTimeoutMinutes(Number(e.target.value))} />
              </Field>
            </div>
          </section>
        </div>

        <div className="mt-4 divide-y divide-zinc-800/80 border-t border-zinc-800/80">
          <details className="group py-1">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between py-2 text-sm font-medium text-zinc-200 [&::-webkit-details-marker]:hidden">
              Identité du bot <span className="text-zinc-500 transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="pb-3">
              <div className="flex gap-2">
                <Input value={botNickname} onChange={(e) => setBotNickname(e.target.value)} maxLength={32} placeholder="Nom par défaut du bot" className="flex-1" />
                <Button variant="secondary" onClick={() => saveNickname.mutate()} loading={saveNickname.isPending}>Appliquer</Button>
              </div>
              {saveNickname.isSuccess && <p className="mt-2 text-sm text-green-400">✓ Surnom appliqué sur ce serveur.</p>}
              {nickMissingPerm && <p className="mt-2 text-sm text-amber-400">Surnom enregistré, mais non appliqué : la permission « Changer de pseudo » manque.</p>}
              {saveNickname.isError && !nickMissingPerm && <p className="mt-2 text-sm text-red-400">Échec de l'application du surnom — réessayez.</p>}
            </div>
          </details>

          <details className="group py-1">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between py-2 text-sm font-medium text-zinc-200 [&::-webkit-details-marker]:hidden">
              Rôles automatiques <span className="text-xs font-normal text-zinc-500">{selectedAutoRoles.length} sélectionné(s) · <span className="inline-block transition-transform group-open:rotate-180">⌄</span></span>
            </summary>
            <div className="flex flex-wrap gap-2 pb-3">
              {roles.data?.filter((r) => !r.managed).map((r) => (
                <Chip key={r.id} selected={selectedAutoRoles.includes(r.id)} onClick={() => setSelectedAutoRoles((prev) => prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id])}>
                  {r.name}
                </Chip>
              ))}
            </div>
          </details>

          <details className="group py-1">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between py-2 text-sm font-medium text-zinc-200 [&::-webkit-details-marker]:hidden">
              Cartes de membre sur mention <span className="text-xs font-normal text-zinc-500">{mentionCards ? "Activées" : "Désactivées"} · <span className="inline-block transition-transform group-open:rotate-180">⌄</span></span>
            </summary>
            <div className="pb-3">
              <Toggle checked={mentionCards} onChange={setMentionCards} label="Activer les cartes de membre" description="Une carte par membre unique mentionné, maximum 3 par message." />
            </div>
          </details>
        </div>
      </Card>

      <InfoCard icon={<Icon.sliders />} title="Bon à savoir">
        Le mute automatique se déclenche au moment du <code>/warn</code> qui atteint le seuil, pas rétroactivement.
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
