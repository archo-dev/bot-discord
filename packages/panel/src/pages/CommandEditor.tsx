import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  VARIABLES,
  type ChannelOption,
  type CommandRevisionDto,
  type CustomCommandDto,
  type GuildModulesResponse,
  type RoleOption,
} from "@bot/shared";
import { EditorWorkspace, FlowSummary } from "../components/editors/EditorWorkspace.js";
import { CommandPreview } from "../components/previews/CommandPreview.js";
import { api, ApiError } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { Badge, Button, Card, ErrorCard, Field, Input, OperationalState, SegmentedControl, Select, Textarea, Toggle } from "../ui/kit.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { TimeAgo } from "../ui/mod-meta.js";
import {
  PERMISSION_OPTIONS,
  buildCommandSummary,
  buildLogic,
  emptyForm,
  hydrate,
  moveItem,
  validateCommandDraft,
  type FormState,
} from "./command-editor/logic.js";
import { ConditionRow } from "./command-editor/ConditionRow.js";
import { ActionRow } from "./command-editor/ActionRow.js";
import type { GuildOutletContext } from "./GuildLayout.js";

const COMMAND_LIMIT = 80;
const cloneForm = (form: FormState): FormState => structuredClone(form);

function saveErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Erreur réseau. Le brouillon est conservé.";
  if (error.status === 403) return "Enregistrement refusé : permissions insuffisantes.";
  if (error.code === "duplicate_name") return "Une commande porte déjà ce nom sur ce serveur.";
  if (error.code.startsWith("invalid_logic")) return "La logique a été refusée par le serveur. Le brouillon est conservé.";
  if (error.code.startsWith("discord_error")) return "Discord a refusé la commande. Le brouillon est conservé.";
  return "Enregistrement impossible. Le brouillon est conservé.";
}

export function CommandEditorPage() {
  const { guildId = "", commandId } = useParams<{ guildId: string; commandId?: string }>();
  const isEditing = commandId !== undefined;
  const navigate = useNavigate();
  const { guild } = useOutletContext<GuildOutletContext>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [form, setForm] = useState<FormState>(() => cloneForm(emptyForm));
  const [baseline, setBaseline] = useState<FormState>(() => cloneForm(emptyForm));
  const [showValidation, setShowValidation] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [pendingCreatedId, setPendingCreatedId] = useState<number | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const existing = useQuery({
    queryKey: ["command", guildId, commandId],
    queryFn: ({ signal }) => api<CustomCommandDto>(`/api/guilds/${guildId}/commands/${commandId}`, { signal }),
    enabled: isEditing,
  });
  const commands = useQuery({
    queryKey: ["commands", guildId],
    queryFn: ({ signal }) => api<CustomCommandDto[]>(`/api/guilds/${guildId}/commands`, { signal }),
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: ({ signal }) => api<RoleOption[]>(`/api/guilds/${guildId}/roles`, { signal }),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: ({ signal }) => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`, { signal }),
  });
  const modules = useQuery({
    queryKey: ["modules", guildId],
    queryFn: ({ signal }) => api<GuildModulesResponse>(`/api/guilds/${guildId}/modules`, { signal }),
    staleTime: 60_000,
  });
  const revisions = useQuery({
    queryKey: ["revisions", guildId, commandId],
    queryFn: ({ signal }) => api<CommandRevisionDto[]>(`/api/guilds/${guildId}/commands/${commandId}/revisions`, { signal }),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existing.data) return;
    const hydrated = hydrate(existing.data);
    setForm(hydrated);
    setBaseline(cloneForm(hydrated));
    if (hydrated.conditions.length || hydrated.extraActions.length || hydrated.cooldownSeconds || hydrated.requiredPermissions) {
      setMode("advanced");
    }
  }, [existing.data]);

  const module = modules.data?.modules.find((candidate) => candidate.id === "custom_commands");
  const configurationAllowed = module?.actions.canConfigure ?? !modules.isError;
  const supportingDataReady = commands.isSuccess && roles.isSuccess && channels.isSuccess && modules.isSuccess;
  const editorEnabled = canWrite && configurationAllowed && supportingDataReady;
  const validation = useMemo(() => validateCommandDraft(form), [form]);
  const dirty = useDirty(form, baseline);
  const summary = useMemo(
    () => buildCommandSummary(form, roles.data ?? [], channels.data ?? []),
    [channels.data, form, roles.data],
  );

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      const body = JSON.stringify({ name: payload.name, description: payload.description, logic: buildLogic(payload) });
      return api<CustomCommandDto>(
        isEditing ? `/api/guilds/${guildId}/commands/${commandId}` : `/api/guilds/${guildId}/commands`,
        { method: isEditing ? "PUT" : "POST", body },
      );
    },
    meta: { silentError: true },
    onSuccess: (saved) => {
      const next = hydrate(saved);
      setForm(next);
      setBaseline(cloneForm(next));
      setShowValidation(false);
      queryClient.setQueryData(["command", guildId, String(saved.id)], saved);
      void queryClient.invalidateQueries({ queryKey: ["commands", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["revisions", guildId, commandId] });
      if (!isEditing) setPendingCreatedId(saved.id);
    },
  });
  useEffect(() => {
    if (pendingCreatedId !== null && !dirty) {
      void navigate(`/guilds/${guildId}/commands/${pendingCreatedId}`, { replace: true });
    }
  }, [dirty, guildId, navigate, pendingCreatedId]);

  const requestSave = () => {
    setShowValidation(true);
    if (!validation.valid) {
      setAnnouncement(`${validation.blockingErrors.length} erreur(s) empêchent l’enregistrement.`);
      document.getElementById("command-validation-summary")?.focus();
      return;
    }
    save.mutate(cloneForm(form));
  };
  const moveCondition = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    set("conditions", moveItem(form.conditions, index, delta));
    setAnnouncement(`Condition ${index + 1} déplacée en position ${target + 1}.`);
    requestAnimationFrame(() => document.getElementById(`command-condition-${target}`)?.focus());
  };
  const moveAction = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    set("extraActions", moveItem(form.extraActions, index, delta));
    setAnnouncement(`Action ${index + 1} déplacée en position ${target + 1}.`);
    requestAnimationFrame(() => document.getElementById(`command-action-${target}`)?.focus());
  };

  if (isEditing && existing.isPending) return <SkeletonSettingsPage cards={4} />;
  if (isEditing && existing.isError) {
    return <ErrorCard message="Impossible de charger cette commande." onRetry={() => void existing.refetch()} />;
  }

  const gatewayRequired = form.triggerType === "keyword";
  const quotaReached = !isEditing && (commands.data?.length ?? 0) >= COMMAND_LIMIT;
  const status = save.isPending ? "pending" : save.isError ? "error" : save.isSuccess ? "success" : "idle";
  const visibleErrors = showValidation ? validation : null;

  return (
    <div className="min-w-0 space-y-4 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={() => void navigate(`/guilds/${guildId}/commands`)} className="text-sm text-indigo-300 hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">
            ← Commandes
          </button>
          <h1 className="mt-1 text-xl font-semibold text-zinc-100">
            {isEditing ? `Modifier /${existing.data?.name ?? "…"}` : "Nouvelle commande"}
          </h1>
        </div>
        <SegmentedControl<"simple" | "advanced">
          ariaLabel="Mode d’édition"
          options={[{ value: "simple", label: "Simple" }, { value: "advanced", label: "Avancé" }]}
          value={mode}
          onChange={setMode}
        />
      </div>

      {(commands.isError || roles.isError || channels.isError || modules.isError) && (
        <ErrorCard
          compact
          title="Données d’édition incomplètes"
          message="Impossible de charger les commandes, rôles, salons ou capacités du module. Le brouillon reste affiché, mais son enregistrement est neutralisé."
          onRetry={() => {
            if (commands.isError) void commands.refetch();
            if (roles.isError) void roles.refetch();
            if (channels.isError) void channels.refetch();
            if (modules.isError) void modules.refetch();
          }}
          retrying={commands.isFetching || roles.isFetching || channels.isFetching || modules.isFetching}
        />
      )}
      {isEditing && revisions.isError && (
        <ErrorCard
          compact
          title="Historique indisponible"
          message="La commande reste modifiable, mais ses révisions n’ont pas pu être chargées."
          onRetry={() => void revisions.refetch()}
          retrying={revisions.isFetching}
        />
      )}
      {!canWrite && (
        <OperationalState
          kind="readonly"
          title="Commande en lecture seule"
          description="Votre rôle panel autorise la consultation du brouillon et de son aperçu, sans modification."
          impact="Les champs et l’enregistrement sont désactivés."
          available="Les révisions et le résumé restent consultables."
        />
      )}
      {canWrite && modules.isSuccess && !configurationAllowed && (
        <OperationalState
          kind="permission"
          title="Permission insuffisante"
          description="Le registre du module indique qu’un prérequis Discord empêche actuellement sa configuration."
          impact="La création et l’enregistrement sont neutralisés."
          available="Le brouillon et le diagnostic du module restent visibles."
        />
      )}
      {module && !module.enabled && (
        <OperationalState
          kind="module"
          title="Module Commandes désactivé"
          description="Les commandes existantes restent conservées, mais leur exécution est arrêtée."
          impact="Aucune commande personnalisée ne répondra sur Discord."
          available="La consultation reste possible ; réactivez le module depuis Modules."
          action={<Button to={`/guilds/${guildId}/modules`} variant="secondary" size="sm">Ouvrir Modules</Button>}
        />
      )}
      {gatewayRequired && !guild?.gatewayConnected && (
        <OperationalState
          kind="gateway"
          title="Gateway indisponible"
          description="Le déclencheur par mot-clé dépend de la Gateway."
          impact="Le mot-clé ne sera pas exécuté tant que la Gateway reste hors ligne."
          available="Le brouillon peut toujours être enregistré."
          action={<Button to={`/guilds/${guildId}/health`} variant="secondary" size="sm">Voir le diagnostic</Button>}
        />
      )}
      {quotaReached && (
        <OperationalState
          kind="quota"
          title="Limite de commandes atteinte"
          description={`Usage actuel : ${commands.data?.length ?? COMMAND_LIMIT}/${COMMAND_LIMIT} commandes. Cette limite de création n’est pas une erreur de formulaire.`}
          impact="La création d’une nouvelle commande est bloquée."
          available="Les commandes existantes peuvent être consultées, modifiées ou supprimées."
          action={<Button to={`/guilds/${guildId}/commands`} variant="secondary" size="sm">Gérer les commandes</Button>}
        />
      )}

      {visibleErrors && visibleErrors.blockingErrors.length > 0 && (
        <div id="command-validation-summary" tabIndex={-1} role="alert" className="rounded-xl border border-red-800 bg-red-950/35 p-4">
          <p className="text-sm font-semibold text-red-200">Corrigez les erreurs suivantes :</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-300">
            {visibleErrors.blockingErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <EditorWorkspace
        mainDescription="Identité, réponse, conditions et actions dans l’ordre envoyé au serveur."
        railDescription="Aperçu local, prérequis et état du brouillon."
        main={
          <fieldset disabled={!editorEnabled || quotaReached} className="space-y-4">
            <Card title="Identité et déclencheur" description="Nom Discord, description et mode de déclenchement." pad="compact">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nom de la commande" error={visibleErrors?.fieldErrors.name} hint="1–32 caractères : a-z, 0-9, - et _">
                  <Input value={form.name} onChange={(event) => set("name", event.target.value.toLowerCase())} placeholder="bienvenue" />
                </Field>
                <Field label="Description" error={visibleErrors?.fieldErrors.description}>
                  <Input value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="Souhaite la bienvenue" maxLength={100} />
                </Field>
              </div>
              <fieldset className="mt-4">
                <legend className="mb-2 text-xs font-semibold text-zinc-300">Déclencheur</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Type">
                    <Select value={form.triggerType} onChange={(event) => set("triggerType", event.target.value as FormState["triggerType"])}>
                      <option value="slash">Commande slash (/)</option>
                      <option value="keyword">Mot-clé (Gateway)</option>
                    </Select>
                  </Field>
                  {form.triggerType === "keyword" && (
                    <Field label="Mots-clés" error={visibleErrors?.fieldErrors.keywords} hint="Séparés par des virgules, 10 maximum.">
                      <Input value={form.keywords} onChange={(event) => set("keywords", event.target.value)} placeholder="bonjour, salut" />
                    </Field>
                  )}
                  {form.triggerType === "keyword" && (
                    <Field label="Correspondance">
                      <Select value={form.matchMode} onChange={(event) => set("matchMode", event.target.value as FormState["matchMode"])}>
                        <option value="contains">Contient</option><option value="exact">Exact</option><option value="starts_with">Commence par</option>
                      </Select>
                    </Field>
                  )}
                </div>
              </fieldset>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
                <span>Activation</span>
                <span>{isEditing ? (existing.data?.enabled ? "Active" : "Inactive") : "Après création"}</span>
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">L’activation utilise l’action dédiée de la liste ; elle ne fait pas partie du contrat d’enregistrement de cet éditeur.</p>
            </Card>

            <Card title="Réponse Discord" description="Réponse principale exécutée avant les actions supplémentaires." pad="compact">
              <Field label="Contenu" error={visibleErrors?.fieldErrors.response}>
                <Textarea className="!min-h-24" maxLength={2000} value={form.replyContent} onChange={(event) => set("replyContent", event.target.value)} placeholder="Bienvenue {mention} sur {server} !" />
              </Field>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {VARIABLES.map((variable) => (
                  <button key={variable.name} type="button" title={variable.description} onClick={() => set("replyContent", form.replyContent + variable.name)} className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-indigo-500 hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">
                    {variable.name}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Toggle checked={form.replyEphemeral} onChange={(value) => set("replyEphemeral", value)} label="Réponse éphémère" />
                <Toggle checked={form.embedEnabled} onChange={(value) => set("embedEnabled", value)} label="Ajouter un embed" />
              </div>
              {form.embedEnabled && (
                <div className="mt-3 grid gap-3 rounded-lg bg-zinc-950 p-3 sm:grid-cols-2">
                  <Field label="Titre de l’embed"><Input value={form.embedTitle} maxLength={256} onChange={(event) => set("embedTitle", event.target.value)} /></Field>
                  <Field label="Description de l’embed"><Input value={form.embedDescription} maxLength={4096} onChange={(event) => set("embedDescription", event.target.value)} /></Field>
                  <Field label="Couleur"><input type="color" className="h-10 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950" value={form.embedColor} onChange={(event) => set("embedColor", event.target.value)} /></Field>
                </div>
              )}
            </Card>

            {mode === "advanced" && (
              <>
                <Card
                  title={`Conditions · ${form.conditions.length}/10`}
                  description="Évaluées dans l’ordre affiché avant toute action."
                  action={<Button type="button" size="sm" variant="secondary" disabled={form.conditions.length >= 10} onClick={() => { set("conditions", [...form.conditions, { type: "user_has_role", roleId: roles.data?.[0]?.id ?? "" }]); setAnnouncement("Condition ajoutée."); }}>+ Condition</Button>}
                  pad="compact"
                >
                  <Field label="Regroupement logique">
                    <Select value={form.conditionMode} onChange={(event) => set("conditionMode", event.target.value as FormState["conditionMode"])}>
                      <option value="all">Toutes requises (ET)</option><option value="any">Au moins une (OU)</option>
                    </Select>
                  </Field>
                  <div className="mt-3 space-y-3">
                    {form.conditions.map((condition, index) => (
                      <ConditionRow key={`${index}-${condition.type}`} condition={condition} roles={roles.data ?? []} channels={(channels.data ?? []).filter((channel) => channel.type !== 4)} index={index} count={form.conditions.length} error={visibleErrors?.conditionErrors[index]} onChange={(next) => set("conditions", form.conditions.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => { set("conditions", form.conditions.filter((_, itemIndex) => itemIndex !== index)); setAnnouncement(`Condition ${index + 1} supprimée.`); }} onMove={(delta) => moveCondition(index, delta)} />
                    ))}
                    {form.conditions.length === 0 && <p className="rounded-lg border border-dashed border-zinc-700 px-3 py-5 text-center text-sm text-zinc-500">Aucune condition : la commande passe directement aux actions.</p>}
                  </div>
                  {form.conditions.length > 0 && (
                    <div className="mt-3"><Field label="Réponse si les conditions échouent"><Input value={form.elseReply} maxLength={2000} onChange={(event) => set("elseReply", event.target.value)} placeholder="Vous ne pouvez pas utiliser cette commande." /></Field></div>
                  )}
                </Card>

                <Card
                  title={`Actions supplémentaires · ${form.extraActions.length}/4`}
                  description="Exécutées après la réponse principale, dans l’ordre affiché."
                  action={<Button type="button" size="sm" variant="secondary" disabled={form.extraActions.length >= 4} onClick={() => { set("extraActions", [...form.extraActions, { type: "increment_counter", counter: "compteur", amount: 1 }]); setAnnouncement("Action ajoutée."); }}>+ Action</Button>}
                  pad="compact"
                >
                  <div className="space-y-3">
                    {form.extraActions.map((action, index) => (
                      <ActionRow key={`${index}-${action.type}`} action={action} roles={roles.data ?? []} channels={(channels.data ?? []).filter((channel) => channel.type !== 4)} index={index} count={form.extraActions.length} error={visibleErrors?.actionErrors[index]} onChange={(next) => set("extraActions", form.extraActions.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => { set("extraActions", form.extraActions.filter((_, itemIndex) => itemIndex !== index)); setAnnouncement(`Action ${index + 1} supprimée.`); }} onMove={(delta) => moveAction(index, delta)} />
                    ))}
                    {form.extraActions.length === 0 && <p className="rounded-lg border border-dashed border-zinc-700 px-3 py-5 text-center text-sm text-zinc-500">Aucune action supplémentaire.</p>}
                  </div>
                </Card>

                <Card title="Garde-fous" description="Cooldown et permission Discord requise." pad="compact">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Cooldown (secondes)" error={visibleErrors?.fieldErrors.cooldownSeconds}><Input type="number" min={0} max={86400} value={form.cooldownSeconds} onChange={(event) => set("cooldownSeconds", Number(event.target.value))} /></Field>
                    <Field label="Portée"><Select value={form.cooldownScope} onChange={(event) => set("cooldownScope", event.target.value as FormState["cooldownScope"])}><option value="user">Par utilisateur</option><option value="guild">Tout le serveur</option></Select></Field>
                    <Field label="Permission requise"><Select value={form.requiredPermissions} onChange={(event) => set("requiredPermissions", event.target.value)}>{PERMISSION_OPTIONS.map((permission) => <option key={permission.value} value={permission.value}>{permission.label}</option>)}</Select></Field>
                  </div>
                </Card>
              </>
            )}
          </fieldset>
        }
        rail={
          <div className="space-y-3">
            <FlowSummary sentence={summary.sentence} steps={summary.steps} label="Fonctionnement de la commande" />
            <CommandPreview form={form} />
            <Card title="État et prérequis" description="Contexte réel de cette commande." pad="compact">
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Statut</dt><dd className="text-right text-zinc-200">{isEditing ? (existing.data?.enabled ? "Active" : "Inactive") : "Non créée"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Module</dt><dd className="text-right text-zinc-200">{module?.enabled === false ? "Désactivé" : "Actif"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Gateway</dt><dd className={`text-right ${gatewayRequired && !guild?.gatewayConnected ? "text-red-300" : "text-zinc-200"}`}>{gatewayRequired ? (guild?.gatewayConnected ? "Requise · connectée" : "Requise · indisponible") : "Non requise pour le slash"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Accès</dt><dd className="text-right text-zinc-200">{canWrite ? "Administration" : "Lecture seule"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Quota serveur</dt><dd className="text-right tabular-nums text-zinc-200">{commands.data?.length ?? "—"}/{COMMAND_LIMIT}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Brouillon</dt><dd className={`text-right ${dirty ? "text-amber-300" : "text-emerald-300"}`}>{dirty ? "Modifié" : "Enregistré"}</dd></div>
              </dl>
            </Card>
            {(validation.warnings.length > 0 || gatewayRequired) && (
              <Card title="Avertissements" pad="compact">
                <ul className="space-y-2 text-xs text-amber-200">{validation.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>
              </Card>
            )}
            {isEditing && revisions.data && revisions.data.length > 0 && (
              <Card title="Historique" pad="compact">
                <ul className="space-y-2">{revisions.data.slice(0, 5).map((revision) => <li key={revision.id} className="flex items-center justify-between gap-2 text-xs"><Badge tone="neutral">{revision.changeType}</Badge><TimeAgo iso={revision.changedAt} className="text-zinc-500" /></li>)}</ul>
              </Card>
            )}
          </div>
        }
      />

      <SaveBar
        dirty={dirty}
        status={status}
        onSave={requestSave}
        onReset={() => { setForm(cloneForm(baseline)); setShowValidation(false); save.reset(); }}
        showWhenClean
        cleanLabel={isEditing ? "Commande enregistrée" : "Nouvelle commande"}
        actionLabel={isEditing ? "Enregistrer" : "Créer la commande"}
        pendingLabel="Enregistrement en cours"
        successLabel="✓ Commande enregistrée"
        errorMessage={saveErrorMessage(save.error)}
        actionDisabled={!editorEnabled || quotaReached}
      />
    </div>
  );
}
