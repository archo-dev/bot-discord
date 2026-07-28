import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChannelOption,
  GuildModulesResponse,
  LogSettingsDto,
  WelcomeSettingsDto,
} from "@bot/shared";
import { ModuleStatusPanel } from "../components/modules/ModuleStatusPanel.js";
import { ModuleWorkspace } from "../components/modules/ModuleWorkspace.js";
import { WelcomeMessagePreview } from "../components/previews/CommunityPreviews.js";
import { useCanWrite } from "../lib/access.js";
import { api, ApiError, fieldError } from "../lib/api.js";
import { buildWelcomePreview, WELCOME_VARIABLES } from "../lib/community-preview.js";
import { Card, ErrorCard, Field, Textarea, Toggle } from "../ui/kit.js";
import { ChannelSelect } from "../ui/entity-select.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import type { GuildOutletContext } from "./GuildLayout.js";

const LOG_TOGGLES: Array<{ key: keyof Omit<LogSettingsDto, "channelId">; label: string }> = [
  { key: "memberJoin", label: "Arrivées de membres" },
  { key: "memberLeave", label: "Départs de membres" },
  { key: "messageDelete", label: "Messages supprimés" },
  { key: "messageEdit", label: "Messages modifiés" },
  { key: "memberUpdate", label: "Membres modifiés (surnom, rôles)" },
  { key: "voiceJoin", label: "Vocal — arrivées dans un salon" },
  { key: "voiceLeave", label: "Vocal — départs d’un salon" },
  { key: "voiceMove", label: "Vocal — changements de salon" },
  { key: "voiceState", label: "Vocal — muet / casque coupé" },
];

const WELCOME_PERMISSIONS = [
  "Voir les salons ciblés",
  "Envoyer des messages",
  "Gérer les rôles pour les autorôles associés",
  "Intent Discord Guild Members",
] as const;

function saveErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Échec de l’enregistrement. Le brouillon est conservé.";
  if (error.status === 403) return "Enregistrement refusé : permissions insuffisantes.";
  if (error.code === "channel_not_in_guild") return "Un salon sélectionné n’appartient plus à ce serveur.";
  if (error.category === "network") return "Connexion indisponible. Le brouillon est conservé.";
  return "Échec de l’enregistrement. Le brouillon est conservé.";
}

function Variables({
  onInsert,
}: {
  onInsert: (variable: string) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-zinc-400">Insérer une variable</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {WELCOME_VARIABLES.map((variable) => (
          <button
            key={variable}
            type="button"
            onClick={() => onInsert(variable)}
            className="rounded-full border border-zinc-700 px-2 py-1 font-mono text-[10px] text-zinc-400 transition hover:border-indigo-500 hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          >
            {variable}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageField({
  label,
  value,
  onChange,
  onInsert,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onInsert: (variable: string) => void;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Field label={label} hint={`${value.length}/2000 caractères`} error={error}>
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          maxLength={2000}
          className="!min-h-24"
        />
      </Field>
      <Variables onInsert={onInsert} />
    </div>
  );
}

export function WelcomePage() {
  const { guildId = "" } = useParams<{ guildId: string }>();
  const { guild } = useOutletContext<GuildOutletContext>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const welcome = useQuery({
    queryKey: ["welcome", guildId],
    queryFn: ({ signal }) => api<WelcomeSettingsDto>(`/api/guilds/${guildId}/welcome`, { signal }),
  });
  const logs = useQuery({
    queryKey: ["log-settings", guildId],
    queryFn: ({ signal }) => api<LogSettingsDto>(`/api/guilds/${guildId}/log-settings`, { signal }),
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

  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [welcomeChannelId, setWelcomeChannelId] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [leaveEnabled, setLeaveEnabled] = useState(false);
  const [leaveChannelId, setLeaveChannelId] = useState("");
  const [leaveMessage, setLeaveMessage] = useState("");
  const [logChannelId, setLogChannelId] = useState("");
  const [logToggles, setLogToggles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!welcome.data) return;
    setWelcomeEnabled(welcome.data.welcomeEnabled);
    setWelcomeChannelId(welcome.data.welcomeChannelId ?? "");
    setWelcomeMessage(welcome.data.welcomeMessage);
    setLeaveEnabled(welcome.data.leaveEnabled);
    setLeaveChannelId(welcome.data.leaveChannelId ?? "");
    setLeaveMessage(welcome.data.leaveMessage);
  }, [welcome.data]);
  useEffect(() => {
    if (!logs.data) return;
    setLogChannelId(logs.data.channelId ?? "");
    setLogToggles(Object.fromEntries(LOG_TOGGLES.map((toggle) => [toggle.key, logs.data[toggle.key]])));
  }, [logs.data]);

  const current = useMemo(() => ({
    welcomeEnabled,
    welcomeChannelId,
    welcomeMessage,
    leaveEnabled,
    leaveChannelId,
    leaveMessage,
    logChannelId,
    toggles: LOG_TOGGLES.map((toggle) => logToggles[toggle.key] ?? false),
  }), [
    leaveChannelId,
    leaveEnabled,
    leaveMessage,
    logChannelId,
    logToggles,
    welcomeChannelId,
    welcomeEnabled,
    welcomeMessage,
  ]);
  const initial = welcome.data && logs.data ? {
    welcomeEnabled: welcome.data.welcomeEnabled,
    welcomeChannelId: welcome.data.welcomeChannelId ?? "",
    welcomeMessage: welcome.data.welcomeMessage,
    leaveEnabled: welcome.data.leaveEnabled,
    leaveChannelId: welcome.data.leaveChannelId ?? "",
    leaveMessage: welcome.data.leaveMessage,
    logChannelId: logs.data.channelId ?? "",
    toggles: LOG_TOGGLES.map((toggle) => logs.data[toggle.key]),
  } : undefined;
  const dirty = useDirty(current, initial);
  const roleModule = modules.data?.modules.find((module) => module.id === "welcome");
  const moduleAllowsConfiguration = roleModule?.actions.canConfigure ?? !modules.isError;
  const welcomePreview = buildWelcomePreview("welcome", welcomeEnabled, welcomeMessage);
  const leavePreview = buildWelcomePreview("leave", leaveEnabled, leaveMessage);
  const channelName = (id: string) => channels.data?.find((channel) => channel.id === id)?.name;

  const save = useMutation({
    mutationFn: async () => {
      const welcomePayload: WelcomeSettingsDto = {
        welcomeEnabled,
        welcomeChannelId: welcomeChannelId || null,
        welcomeMessage,
        leaveEnabled,
        leaveChannelId: leaveChannelId || null,
        leaveMessage,
      };
      const logPayload: LogSettingsDto = {
        channelId: logChannelId || null,
        memberJoin: logToggles["memberJoin"] ?? false,
        memberLeave: logToggles["memberLeave"] ?? false,
        messageDelete: logToggles["messageDelete"] ?? false,
        messageEdit: logToggles["messageEdit"] ?? false,
        memberUpdate: logToggles["memberUpdate"] ?? false,
        voiceJoin: logToggles["voiceJoin"] ?? false,
        voiceLeave: logToggles["voiceLeave"] ?? false,
        voiceMove: logToggles["voiceMove"] ?? false,
        voiceState: logToggles["voiceState"] ?? false,
      };
      await api(`/api/guilds/${guildId}/welcome`, { method: "PUT", body: JSON.stringify(welcomePayload) });
      await api(`/api/guilds/${guildId}/log-settings`, { method: "PUT", body: JSON.stringify(logPayload) });
      return { welcomePayload, logPayload };
    },
    meta: { silentError: true },
    onSuccess: ({ welcomePayload, logPayload }) => {
      queryClient.setQueryData(["welcome", guildId], welcomePayload);
      queryClient.setQueryData(["log-settings", guildId], logPayload);
      void queryClient.invalidateQueries({ queryKey: ["welcome", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["log-settings", guildId] });
    },
  });

  const resetForm = () => {
    if (!welcome.data || !logs.data) return;
    setWelcomeEnabled(welcome.data.welcomeEnabled);
    setWelcomeChannelId(welcome.data.welcomeChannelId ?? "");
    setWelcomeMessage(welcome.data.welcomeMessage);
    setLeaveEnabled(welcome.data.leaveEnabled);
    setLeaveChannelId(welcome.data.leaveChannelId ?? "");
    setLeaveMessage(welcome.data.leaveMessage);
    setLogChannelId(logs.data.channelId ?? "");
    setLogToggles(Object.fromEntries(LOG_TOGGLES.map((toggle) => [toggle.key, logs.data[toggle.key]])));
    save.reset();
  };

  if (welcome.isPending || logs.isPending) return <SkeletonSettingsPage cards={3} />;
  if (welcome.isError || logs.isError) {
    return (
      <ErrorCard
        message="Impossible de charger les messages d’accueil ou les journaux."
        onRetry={() => {
          void welcome.refetch();
          void logs.refetch();
        }}
      />
    );
  }

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
            : "Impossible de charger les salons. Les messages et aperçus restent consultables."}
          onRetry={() => {
            if (channels.isError) void channels.refetch();
            if (modules.isError) void modules.refetch();
          }}
          retrying={channels.isFetching || modules.isFetching}
        />
      )}
      <ModuleWorkspace
        configurationDescription="Configurez les messages, leurs destinations et les journaux."
        previewDescription="Démonstration locale mise à jour depuis le brouillon."
        contextDescription="État réel du module, prérequis et résumé de configuration."
        configuration={
          <fieldset disabled={!canWrite || !moduleAllowsConfiguration} className="space-y-3">
            {!canWrite && (
              <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-xs text-amber-200">
                Lecture seule : la configuration et les aperçus restent consultables.
              </div>
            )}
            {canWrite && modules.isSuccess && !moduleAllowsConfiguration && (
              <div role="alert" className="rounded-xl border border-red-900/60 bg-red-950/25 px-3 py-2.5 text-xs text-red-200">
                Enregistrement indisponible : une permission ou capacité requise manque.
              </div>
            )}
            {!guild?.gatewayConnected && (
              <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
                Gateway indisponible : les réglages peuvent être enregistrés, mais aucun message d’arrivée, de départ ou journal temps réel ne sera envoyé.
              </div>
            )}
            {roleModule && !roleModule.enabled && (
              <div role="status" className="rounded-xl border border-zinc-700 bg-zinc-900/70 px-3 py-2.5 text-xs leading-relaxed text-zinc-300">
                Module désactivé : la configuration est conservée, mais son exécution reste arrêtée.
              </div>
            )}

            <Card
              title="Message de bienvenue"
              description="Envoyé par la Gateway à chaque arrivée de membre."
              action={<Toggle ariaLabel="Activer le message de bienvenue" checked={welcomeEnabled} onChange={setWelcomeEnabled} />}
              pad="compact"
            >
              <div className="grid gap-3">
                <Field label="Salon cible" hint="Aucun envoi n’est possible sans salon lorsque le message est activé.">
                  <ChannelSelect
                    guildId={guildId}
                    value={welcomeChannelId || null}
                    onChange={(id) => setWelcomeChannelId(id ?? "")}
                    placeholder="— Aucun salon —"
                  />
                </Field>
                <MessageField
                  label="Message de bienvenue"
                  value={welcomeMessage}
                  onChange={setWelcomeMessage}
                  onInsert={(variable) => setWelcomeMessage((message) => message + variable)}
                  error={fieldError(save.error, "welcomeMessage")}
                />
              </div>
            </Card>

            <Card
              title="Message de départ"
              description="Envoyé par la Gateway quand un membre quitte le serveur."
              action={<Toggle ariaLabel="Activer le message de départ" checked={leaveEnabled} onChange={setLeaveEnabled} />}
              pad="compact"
            >
              <div className="grid gap-3">
                <Field label="Salon cible">
                  <ChannelSelect
                    guildId={guildId}
                    value={leaveChannelId || null}
                    onChange={(id) => setLeaveChannelId(id ?? "")}
                    placeholder="— Aucun salon —"
                  />
                </Field>
                <MessageField
                  label="Message de départ"
                  value={leaveMessage}
                  onChange={setLeaveMessage}
                  onInsert={(variable) => setLeaveMessage((message) => message + variable)}
                  error={fieldError(save.error, "leaveMessage")}
                />
              </div>
            </Card>

            <Card title="Journaux serveur" description="Embeds techniques distincts du journal de modération." pad="compact">
              <Field label="Salon des journaux">
                <ChannelSelect
                  guildId={guildId}
                  value={logChannelId || null}
                  onChange={(id) => setLogChannelId(id ?? "")}
                  placeholder="— Aucun salon —"
                />
              </Field>
              <fieldset className="mt-3">
                <legend className="mb-1 text-xs font-semibold text-zinc-300">Événements consignés</legend>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  {LOG_TOGGLES.map((toggle) => (
                    <div key={toggle.key} className="border-b border-white/5 py-2.5">
                      <Toggle
                        label={toggle.label}
                        checked={logToggles[toggle.key] ?? false}
                        onChange={(value) => setLogToggles((currentLogs) => ({ ...currentLogs, [toggle.key]: value }))}
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            </Card>
          </fieldset>
        }
        preview={
          <div className="space-y-3">
            <WelcomeMessagePreview preview={welcomePreview} />
            <WelcomeMessagePreview preview={leavePreview} />
          </div>
        }
        context={
          <div className="space-y-3">
            <ModuleStatusPanel
              module={roleModule}
              moduleLoading={modules.isPending}
              moduleError={modules.isError}
              gatewayConnected={guild?.gatewayConnected === true}
              canWrite={canWrite}
              configurationAllowed={moduleAllowsConfiguration}
              enabled={welcomeEnabled || leaveEnabled}
              targetChannel={channelName(welcomeChannelId) ? `#${channelName(welcomeChannelId)}` : ""}
              dirtyState={dirtyState}
            />
            <Card title="Prérequis" description="Nécessaires à l’exécution réelle." pad="compact">
              <ul className="space-y-2">
                {WELCOME_PERMISSIONS.map((permission) => (
                  <li key={permission} className="flex items-start gap-2 text-xs text-zinc-400">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-hidden />
                    {permission}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Variables disponibles" description="Remplacées par la Gateway au moment de l’envoi." pad="compact">
              <dl className="space-y-2 text-[11px]">
                <div className="flex justify-between gap-3"><dt className="font-mono text-indigo-300">{"{mention}"}</dt><dd className="text-right text-zinc-500">mention du membre</dd></div>
                <div className="flex justify-between gap-3"><dt className="font-mono text-indigo-300">{"{user}"}</dt><dd className="text-right text-zinc-500">nom du membre</dd></div>
                <div className="flex justify-between gap-3"><dt className="font-mono text-indigo-300">{"{user.id}"}</dt><dd className="text-right text-zinc-500">identifiant du membre</dd></div>
                <div className="flex justify-between gap-3"><dt className="font-mono text-indigo-300">{"{server}"}</dt><dd className="text-right text-zinc-500">nom du serveur</dd></div>
                <div className="flex justify-between gap-3"><dt className="font-mono text-indigo-300">{"{membercount}"}</dt><dd className="text-right text-zinc-500">nombre de membres</dd></div>
              </dl>
              <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">Les valeurs visibles dans l’aperçu sont explicitement des démonstrations locales.</p>
            </Card>
            <Card title="Journaux" description="Résumé du brouillon actuel." pad="compact">
              <p className="text-xs text-zinc-400">
                <span className="font-semibold tabular-nums text-zinc-200">
                  {LOG_TOGGLES.filter((toggle) => logToggles[toggle.key]).length}
                </span>{" "}
                événement(s) activé(s)
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Salon : {channelName(logChannelId) ? `#${channelName(logChannelId)}` : "Non sélectionné"}
              </p>
            </Card>
          </div>
        }
      />

      <SaveBar
        dirty={dirty}
        status={status}
        onSave={() => save.mutate()}
        onReset={resetForm}
        errorMessage={saveErrorMessage(save.error)}
      />
    </div>
  );
}
