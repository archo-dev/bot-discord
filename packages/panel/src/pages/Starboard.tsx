import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChannelOption,
  GuildModulesResponse,
  StarboardSettingsDto,
} from "@bot/shared";
import { ModuleStatusPanel } from "../components/modules/ModuleStatusPanel.js";
import { ModuleWorkspace } from "../components/modules/ModuleWorkspace.js";
import { StarboardMessagePreview } from "../components/previews/CommunityPreviews.js";
import { useCanWrite } from "../lib/access.js";
import { api, ApiError, fieldError } from "../lib/api.js";
import { buildStarboardPreview } from "../lib/community-preview.js";
import { Card, ErrorCard, Field, Input, Toggle } from "../ui/kit.js";
import { ChannelSelect } from "../ui/entity-select.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import type { GuildOutletContext } from "./GuildLayout.js";

const STARBOARD_RULES = [
  "Les réactions des bots ne sont pas comptées.",
  "L’auteur ne peut pas promouvoir son propre message.",
  "Les messages du salon Starboard sont exclus.",
  "L’embed est actualisé avec le compteur puis supprimé sous le seuil.",
] as const;

const STARBOARD_PERMISSIONS = [
  "Voir le salon source et le salon Starboard",
  "Envoyer des messages",
  "Intégrer des liens",
  "Intent Discord Guild Message Reactions",
] as const;

function saveErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Échec de l’enregistrement. Le brouillon est conservé.";
  if (error.status === 403) return "Enregistrement refusé : permissions insuffisantes.";
  if (error.code === "channel_not_in_guild") return "Le salon sélectionné n’appartient plus à ce serveur.";
  if (error.category === "network") return "Connexion indisponible. Le brouillon est conservé.";
  return "Échec de l’enregistrement. Le brouillon est conservé.";
}

export function StarboardPage() {
  const { guildId = "" } = useParams<{ guildId: string }>();
  const { guild } = useOutletContext<GuildOutletContext>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const settings = useQuery({
    queryKey: ["starboard-settings", guildId],
    queryFn: ({ signal }) => api<StarboardSettingsDto>(`/api/guilds/${guildId}/starboard-settings`, { signal }),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: ({ signal }) => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`, { signal }),
    staleTime: 60_000,
  });
  const modules = useQuery({
    queryKey: ["modules", guildId],
    queryFn: ({ signal }) => api<GuildModulesResponse>(`/api/guilds/${guildId}/modules`, { signal }),
    staleTime: 60_000,
  });
  const [draft, setDraft] = useState<StarboardSettingsDto | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async (payload: StarboardSettingsDto) => {
      await api(`/api/guilds/${guildId}/starboard-settings`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      return payload;
    },
    meta: { silentError: true },
    onSuccess: (payload) => {
      queryClient.setQueryData(["starboard-settings", guildId], payload);
      void queryClient.invalidateQueries({ queryKey: ["starboard-settings", guildId] });
    },
  });

  const dirty = useDirty(draft, settings.data);
  const module = modules.data?.modules.find((candidate) => candidate.id === "starboard");
  const moduleAllowsConfiguration = module?.actions.canConfigure ?? !modules.isError;

  if (settings.isError) {
    return <ErrorCard message="Impossible de charger la configuration du Starboard." onRetry={() => void settings.refetch()} />;
  }
  if (settings.isPending || !draft) return <SkeletonSettingsPage cards={3} />;

  const set = (patch: Partial<StarboardSettingsDto>) =>
    setDraft((current) => current ? { ...current, ...patch } : current);
  const targetChannel = channels.data?.find((channel) => channel.id === draft.channelId)?.name ?? null;
  const preview = buildStarboardPreview(draft, targetChannel);
  const status = save.isPending ? "pending" : save.isError ? "error" : save.isSuccess ? "success" : "idle";
  const dirtyState = save.isError
    ? { label: "Échec de sauvegarde", tone: "danger" as const }
    : dirty
      ? { label: "Modifications non enregistrées", tone: "warning" as const }
      : { label: "Configuration enregistrée", tone: "success" as const };

  return (
    <div className="min-w-0 space-y-4 pb-3">
      {(channels.isError || modules.isError) && (
        <ErrorCard
          compact
          title="Contexte Discord incomplet"
          message={modules.isError
            ? "Impossible de vérifier les capacités du module. L’enregistrement est neutralisé, mais le brouillon reste affiché."
            : "Impossible de charger les salons. Le réglage courant et l’aperçu restent consultables."}
          onRetry={() => {
            if (channels.isError) void channels.refetch();
            if (modules.isError) void modules.refetch();
          }}
          retrying={channels.isFetching || modules.isFetching}
        />
      )}
      <ModuleWorkspace
        configurationDescription="Définissez la destination, l’emoji et le seuil de sélection."
        previewDescription="Démonstration locale mise à jour depuis le brouillon."
        contextDescription="État réel du module, prérequis et limites des données disponibles."
        configuration={
          <fieldset disabled={!canWrite || !moduleAllowsConfiguration} className="space-y-3">
            {!canWrite && (
              <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-xs text-amber-200">
                Lecture seule : la configuration et l’aperçu restent consultables.
              </div>
            )}
            {canWrite && modules.isSuccess && !moduleAllowsConfiguration && (
              <div role="alert" className="rounded-xl border border-red-900/60 bg-red-950/25 px-3 py-2.5 text-xs text-red-200">
                Enregistrement indisponible : une permission ou capacité requise manque.
              </div>
            )}
            {!guild?.gatewayConnected && (
              <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
                Gateway indisponible : la configuration reste enregistrable, mais les réactions ne peuvent pas alimenter le Starboard.
              </div>
            )}
            {module && !module.enabled && (
              <div role="status" className="rounded-xl border border-zinc-700 bg-zinc-900/70 px-3 py-2.5 text-xs leading-relaxed text-zinc-300">
                Module désactivé : aucun nouveau message ne sera sélectionné, mais la configuration reste conservée.
              </div>
            )}

            <Card
              title="Activation et destination"
              description="Choisissez où les messages éligibles seront republiés."
              action={<Toggle ariaLabel="Activer le Starboard" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />}
              pad="compact"
            >
              <Field label="Salon du Starboard" error={fieldError(save.error, "channelId")}>
                <ChannelSelect
                  guildId={guildId}
                  value={draft.channelId}
                  onChange={(channelId) => set({ channelId })}
                  placeholder="— Choisir un salon —"
                />
              </Field>
            </Card>

            <Card title="Déclenchement" description="Emoji observé et nombre minimal de réactions uniques." pad="compact">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Seuil de réactions"
                  hint="Entre 1 et 50 réactions."
                  error={fieldError(save.error, "threshold")}
                >
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={draft.threshold}
                    onChange={(event) => set({ threshold: Number(event.target.value) })}
                  />
                </Field>
                <Field
                  label="Emoji"
                  hint="Unicode ou tag d’emoji personnalisé, 64 caractères maximum."
                  error={fieldError(save.error, "emoji")}
                >
                  <Input
                    value={draft.emoji}
                    onChange={(event) => set({ emoji: event.target.value })}
                    maxLength={64}
                    placeholder="⭐"
                  />
                </Field>
              </div>
            </Card>

            <Card title="Éligibilité et exclusions" description="Règles actuelles, appliquées automatiquement." pad="compact">
              <ul className="grid gap-2 sm:grid-cols-2">
                {STARBOARD_RULES.map((rule) => (
                  <li key={rule} className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/25 px-3 py-2.5 text-xs leading-relaxed text-zinc-400">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                    {rule}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                Ces exclusions ne sont pas configurables dans le contrat actuel et ne déclenchent aucune lecture d’historique.
              </p>
            </Card>
          </fieldset>
        }
        preview={<StarboardMessagePreview preview={preview} />}
        context={
          <div className="space-y-3">
            <ModuleStatusPanel
              module={module}
              moduleLoading={modules.isPending}
              moduleError={modules.isError}
              gatewayConnected={guild?.gatewayConnected === true}
              canWrite={canWrite}
              configurationAllowed={moduleAllowsConfiguration}
              enabled={draft.enabled}
              targetChannel={targetChannel ? `#${targetChannel}` : ""}
              dirtyState={dirtyState}
            />
            <Card title="Seuil actif" description="Valeur du brouillon local." pad="compact">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-3xl font-bold tabular-nums text-zinc-100">{preview.threshold}</p>
                  <p className="mt-1 text-xs text-zinc-500">réaction(s) requise(s)</p>
                </div>
                <span className="max-w-24 truncate rounded-lg border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-lg" title={preview.emoji}>
                  {preview.emoji}
                </span>
              </div>
            </Card>
            <Card title="Prérequis" description="Nécessaires à l’exécution réelle." pad="compact">
              <ul className="space-y-2">
                {STARBOARD_PERMISSIONS.map((permission) => (
                  <li key={permission} className="flex items-start gap-2 text-xs text-zinc-400">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-hidden />
                    {permission}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Limites du contexte" description="Aucune donnée distante inventée." pad="compact">
              <p className="text-[11px] leading-relaxed text-zinc-400">
                Le panel ne charge ni publication Starboard, ni historique, ni pièce jointe réelle sur cette page. L’aperçu est exclusivement une démonstration locale du format.
              </p>
            </Card>
          </div>
        }
      />

      <SaveBar
        dirty={dirty}
        status={status}
        onSave={() => save.mutate(draft)}
        onReset={() => {
          if (settings.data) setDraft(settings.data);
          save.reset();
        }}
        errorMessage={saveErrorMessage(save.error)}
      />
    </div>
  );
}
