import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AutomationCatalogDto,
  AutomationComponentDefinition,
  AutomationEventContext,
  AutomationRevisionDto,
  AutomationSimulationResult,
  AutomationWorkflowDto,
  AutomationWorkflowInput,
  ChannelOption,
  GuildModulesResponse,
  RoleOption,
} from "@bot/shared";
import { EditorWorkspace, FlowSummary } from "../components/editors/EditorWorkspace.js";
import { ModuleStatusPanel } from "../components/modules/ModuleStatusPanel.js";
import { api, ApiError } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { DisclosureCard } from "../ui/disclosure.js";
import { Badge, Button, Card, ErrorCard, Field, Input, OperationalState, Select, Textarea, Toggle } from "../ui/kit.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonList, SkeletonSettingsPage } from "../ui/skeleton.js";
import { toast } from "../ui/toast.js";
import {
  buildAutomationFlowSummary,
  createEmptyAutomationWorkflow,
  moveAutomationItem,
  toAutomationInput,
  validateAutomationDraft,
} from "./automation-editor/logic.js";
import type { GuildOutletContext } from "./GuildLayout.js";

type EditableComponent = {
  id?: string;
  type: string;
  config: Record<string, unknown>;
  negate?: boolean;
  continueOnError?: boolean;
};
type CatalogItem = AutomationComponentDefinition<string>;

function initialValue(field: CatalogItem["configFields"][number], componentType: string): unknown {
  if (field.type === "boolean") return componentType === "message_create" && field.key === "ignoreBots";
  if (field.type === "number") {
    if (field.key === "autoArchiveMinutes") return 1440;
    if (field.key === "seconds" && componentType !== "modify_slowmode") return 10;
    return 0;
  }
  if (field.type === "json") return field.key === "days" ? [1] : {};
  if (field.type === "select") return field.options?.[0] ?? "";
  return "";
}

function newComponent(definition: CatalogItem, kind: "trigger" | "condition" | "action"): EditableComponent {
  const config = Object.fromEntries(definition.configFields.map((field) => [field.key, initialValue(field, definition.id)]));
  return {
    id: crypto.randomUUID(),
    type: definition.id,
    config,
    ...(kind === "condition" ? { negate: false } : {}),
    ...(kind === "action" ? { continueOnError: false } : {}),
  };
}

function ComponentFields({
  definition,
  component,
  roles,
  channels,
  errorFor,
  onChange,
}: {
  definition: CatalogItem;
  component: EditableComponent;
  roles: RoleOption[];
  channels: ChannelOption[];
  errorFor: (field: string) => string | undefined;
  onChange: (next: EditableComponent) => void;
}) {
  const setConfig = (key: string, value: unknown) =>
    onChange({ ...component, config: { ...component.config, [key]: value } });
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {definition.configFields.map((field) => {
        const value = component.config[field.key];
        const label = <>{field.label}{field.required ? <span className="text-red-400"> *</span> : null}</>;
        const error = errorFor(field.key);
        if (field.type === "boolean") {
          return <div key={field.key} className="flex items-end pb-2"><Toggle checked={value === true} onChange={(checked) => setConfig(field.key, checked)} label={field.label} /></div>;
        }
        if (field.type === "role") {
          return <Field key={field.key} label={label} error={error}><Select value={String(value ?? "")} onChange={(event) => setConfig(field.key, event.target.value)}><option value="">Rôle du contexte</option>{roles.filter((role) => !role.managed).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</Select></Field>;
        }
        if (field.type === "channel") {
          return <Field key={field.key} label={label} error={error}><Select value={String(value ?? "")} onChange={(event) => setConfig(field.key, event.target.value)}><option value="">Salon du contexte</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</Select></Field>;
        }
        if (field.type === "select") {
          return <Field key={field.key} label={label} error={error}><Select value={String(value ?? "")} onChange={(event) => setConfig(field.key, event.target.value)}>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</Select></Field>;
        }
        if (field.type === "textarea") {
          return <Field key={field.key} label={label} error={error}><Textarea className="!min-h-24" value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => setConfig(field.key, event.target.value)} /></Field>;
        }
        if (field.type === "json") {
          return <Field key={field.key} label={label} hint="JSON valide" error={error}><Textarea className="!min-h-24 font-mono text-xs" value={typeof value === "string" ? value : JSON.stringify(value, null, 2)} onChange={(event) => setConfig(field.key, event.target.value)} onBlur={(event) => { try { setConfig(field.key, JSON.parse(event.target.value)); } catch { /* L’erreur locale reste visible. */ } }} /></Field>;
        }
        return <Field key={field.key} label={label} error={error}><Input type={field.type === "number" ? "number" : "text"} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => setConfig(field.key, field.type === "number" ? Number(event.target.value) : event.target.value)} /></Field>;
      })}
    </div>
  );
}

function AutomationComponentCard({
  index = 0,
  kind,
  component,
  catalog,
  roles,
  channels,
  count,
  errors,
  onChange,
  onRemove,
  onMove,
}: {
  index?: number;
  kind: "trigger" | "condition" | "action";
  component: EditableComponent;
  catalog: readonly CatalogItem[];
  roles: RoleOption[];
  channels: ChannelOption[];
  count: number;
  errors: Readonly<Record<string, string>>;
  onChange: (next: EditableComponent) => void;
  onRemove?: () => void;
  onMove?: (delta: -1 | 1) => void;
}) {
  const definition = catalog.find((entry) => entry.id === component.type) ?? catalog[0];
  if (!definition) return null;
  const prefix = `${kind}.${index}`;
  const cardError = errors[prefix] || Object.entries(errors).find(([key]) => key.startsWith(`${prefix}.`))?.[1];
  const displayIndex = kind === "trigger" ? null : index + 1;
  const label = kind === "trigger" ? "Déclencheur" : kind === "condition" ? `Condition ${index + 1}` : `Action ${index + 1}`;
  return (
    <article
      id={`automation-${kind}-${index}`}
      tabIndex={-1}
      aria-label={label}
      className={`rounded-xl border bg-zinc-950/55 p-3 ${cardError ? "border-red-700/70" : "border-zinc-800"}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {displayIndex !== null && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-300">{displayIndex}</span>}
        <Select
          className="min-w-52 flex-1"
          aria-label={`Type — ${label}`}
          value={component.type}
          onChange={(event) => {
            const next = catalog.find((entry) => entry.id === event.target.value);
            if (next) onChange(newComponent(next, kind));
          }}
        >
          {catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </Select>
        <Badge tone="neutral">{definition.category}</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {onMove && (
            <>
              <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Monter ${label.toLocaleLowerCase()}`}>↑</Button>
              <Button type="button" size="sm" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Descendre ${label.toLocaleLowerCase()}`}>↓</Button>
            </>
          )}
          {onRemove && <Button type="button" size="sm" variant="ghost" className="text-red-400" onClick={onRemove} aria-label={`Supprimer ${label.toLocaleLowerCase()}`}>Supprimer</Button>}
        </div>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">{definition.description}</p>
      {definition.requiredPermissions.length > 0 && <p className="mb-3 text-[11px] text-amber-300">Permissions : {definition.requiredPermissions.join(", ")}</p>}
      <ComponentFields definition={definition} component={component} roles={roles} channels={channels} errorFor={(field) => errors[`${prefix}.${field}`]} onChange={onChange} />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {kind === "condition" && <Toggle checked={component.negate === true} onChange={(negate) => onChange({ ...component, negate })} label="Inverser la condition" />}
        {kind === "action" && <Toggle checked={component.continueOnError === true} onChange={(continueOnError) => onChange({ ...component, continueOnError })} label="Continuer si erreur" />}
      </div>
      {cardError && !Object.keys(errors).some((key) => key.startsWith(`${prefix}.`)) && <p role="alert" className="mt-2 text-xs text-red-300">{cardError}</p>}
    </article>
  );
}

function saveErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiError)) return "Erreur réseau. Le brouillon est conservé.";
  if (cause.status === 403) return "Enregistrement refusé : permissions insuffisantes.";
  if (cause.code === "duplicate_name") return "Une automatisation porte déjà ce nom.";
  return "La configuration a été refusée. Le brouillon est conservé.";
}

export function AutomationEditorPage() {
  const { guildId = "", automationId } = useParams<{ guildId: string; automationId?: string }>();
  const isEditing = automationId !== undefined;
  const navigate = useNavigate();
  const { guild } = useOutletContext<GuildOutletContext>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [workflow, setWorkflow] = useState<AutomationWorkflowInput>(createEmptyAutomationWorkflow);
  const [baseline, setBaseline] = useState<AutomationWorkflowInput>(createEmptyAutomationWorkflow);
  const [showValidation, setShowValidation] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [simulationJson, setSimulationJson] = useState("");
  const [simulation, setSimulation] = useState<AutomationSimulationResult | null>(null);
  const [showSimulation, setShowSimulation] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingCreatedId, setPendingCreatedId] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ["automation-catalog", guildId],
    queryFn: ({ signal }) => api<AutomationCatalogDto>(`/api/guilds/${guildId}/automations/catalog`, { signal }),
  });
  const existing = useQuery({
    queryKey: ["automation", guildId, automationId],
    queryFn: ({ signal }) => api<AutomationWorkflowDto>(`/api/guilds/${guildId}/automations/${automationId}`, { signal }),
    enabled: isEditing,
  });
  const roles = useQuery({ queryKey: ["roles", guildId], queryFn: ({ signal }) => api<RoleOption[]>(`/api/guilds/${guildId}/roles`, { signal }) });
  const channels = useQuery({ queryKey: ["channels", guildId], queryFn: ({ signal }) => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`, { signal }) });
  const modules = useQuery({
    queryKey: ["modules", guildId],
    queryFn: ({ signal }) => api<GuildModulesResponse>(`/api/guilds/${guildId}/modules`, { signal }),
    staleTime: 60_000,
  });
  const revisions = useQuery({
    queryKey: ["automation-revisions", guildId, automationId],
    queryFn: ({ signal }) => api<AutomationRevisionDto[]>(`/api/guilds/${guildId}/automations/${automationId}/revisions`, { signal }),
    enabled: isEditing && showHistory,
  });

  useEffect(() => {
    if (!existing.data) return;
    const next = toAutomationInput(existing.data);
    setWorkflow(next);
    setBaseline(toAutomationInput(existing.data));
  }, [existing.data]);
  useEffect(() => {
    setSimulationJson(JSON.stringify({ event: { type: workflow.trigger.type, id: "panel-simulation", depth: 0 }, guild: { id: guildId } }, null, 2));
  }, [guildId, workflow.trigger.type]);

  const definitions = catalog.data;
  const validation = useMemo(
    () => definitions ? validateAutomationDraft(workflow, definitions) : null,
    [definitions, workflow],
  );
  const summary = useMemo(
    () => definitions ? buildAutomationFlowSummary(workflow, definitions) : null,
    [definitions, workflow],
  );
  const dirty = useDirty(workflow, baseline);
  const module = modules.data?.modules.find((candidate) => candidate.id === "automations");
  const configurationAllowed = module?.actions.canConfigure ?? !modules.isError;
  const supportingDataReady = roles.isSuccess && channels.isSuccess && modules.isSuccess;
  const editorEnabled = canWrite && configurationAllowed && supportingDataReady;

  const save = useMutation({
    mutationFn: (payload: AutomationWorkflowInput) =>
      api<AutomationWorkflowDto>(
        isEditing ? `/api/guilds/${guildId}/automations/${automationId}` : `/api/guilds/${guildId}/automations`,
        { method: isEditing ? "PUT" : "POST", body: JSON.stringify(payload) },
      ),
    meta: { silentError: true },
    onSuccess: (saved) => {
      const next = toAutomationInput(saved);
      setWorkflow(next);
      setBaseline(toAutomationInput(saved));
      setShowValidation(false);
      queryClient.setQueryData(["automation", guildId, saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["automations", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["automation-revisions", guildId, automationId] });
      if (!isEditing) setPendingCreatedId(saved.id);
    },
  });
  useEffect(() => {
    if (pendingCreatedId && !dirty) {
      void navigate(`/guilds/${guildId}/automations/${pendingCreatedId}`, { replace: true });
    }
  }, [dirty, guildId, navigate, pendingCreatedId]);

  const simulate = useMutation({
    mutationFn: () => api<AutomationSimulationResult>(`/api/guilds/${guildId}/automations/${automationId}/simulate`, {
      method: "POST",
      body: JSON.stringify(JSON.parse(simulationJson) as AutomationEventContext),
    }),
    meta: { silentError: true },
    onSuccess: setSimulation,
    onError: () => toast.error("Contexte de simulation invalide."),
  });
  const requestSave = () => {
    setShowValidation(true);
    if (!validation?.valid) {
      setAnnouncement(`${validation?.blockingErrors.length ?? 1} erreur(s) empêchent l’enregistrement.`);
      document.getElementById("automation-validation-summary")?.focus();
      return;
    }
    save.mutate(toAutomationInput(workflow));
  };
  const moveComponent = (kind: "condition" | "action", index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (kind === "condition") setWorkflow({ ...workflow, conditions: moveAutomationItem(workflow.conditions, index, delta) });
    else setWorkflow({ ...workflow, actions: moveAutomationItem(workflow.actions, index, delta) });
    setAnnouncement(`${kind === "condition" ? "Condition" : "Action"} ${index + 1} déplacée en position ${target + 1}.`);
    requestAnimationFrame(() => document.getElementById(`automation-${kind}-${target}`)?.focus());
  };

  if (catalog.isPending || (isEditing && existing.isPending)) return <SkeletonSettingsPage cards={4} />;
  if (catalog.isError) return <ErrorCard message="Impossible de charger le catalogue des automatisations." onRetry={() => void catalog.refetch()} />;
  if (isEditing && existing.isError) return <ErrorCard message="Impossible de charger cette automatisation." onRetry={() => void existing.refetch()} />;
  if (!definitions || !summary || !validation) return <SkeletonSettingsPage cards={4} />;

  const visibleErrors = showValidation ? validation : null;
  const status = save.isPending ? "pending" : save.isError ? "error" : save.isSuccess ? "success" : "idle";
  const dirtyState = save.isError
    ? { label: "Échec de sauvegarde", tone: "danger" as const }
    : dirty
      ? { label: "Modifications non enregistrées", tone: "warning" as const }
      : { label: "Configuration enregistrée", tone: "success" as const };

  return (
    <div className="min-w-0 space-y-4 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={() => void navigate(`/guilds/${guildId}/automations`)} className="text-sm text-indigo-300 hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">← Automatisations</button>
          <h1 className="mt-1 text-xl font-semibold text-zinc-100">{isEditing ? workflow.name || "Automatisation" : "Nouvelle automatisation"}</h1>
        </div>
        {isEditing && <Button variant="secondary" onClick={() => setShowSimulation(true)}>Mode test</Button>}
      </div>

      {(roles.isError || channels.isError || modules.isError) && (
        <ErrorCard
          compact
          title="Données d’édition incomplètes"
          message="Impossible de charger les rôles, salons ou capacités du module. Le brouillon reste affiché, mais son enregistrement est neutralisé."
          onRetry={() => {
            if (roles.isError) void roles.refetch();
            if (channels.isError) void channels.refetch();
            if (modules.isError) void modules.refetch();
          }}
          retrying={roles.isFetching || channels.isFetching || modules.isFetching}
        />
      )}
      {showHistory && revisions.isError && (
        <ErrorCard compact title="Historique indisponible" message="Le flux reste modifiable, mais ses révisions n’ont pas pu être chargées." onRetry={() => void revisions.refetch()} retrying={revisions.isFetching} />
      )}
      {!canWrite && <OperationalState kind="readonly" title="Automatisation en lecture seule" description="Votre rôle panel permet de consulter le flux et ses composants, sans les modifier." />}
      {canWrite && modules.isSuccess && !configurationAllowed && <OperationalState kind="permission" title="Permission insuffisante" description="Un prérequis Discord exposé par le module neutralise la configuration." />}
      {module && !module.enabled && <OperationalState kind="module" title="Module Automatisations désactivé" description="La définition reste conservée, mais aucune exécution n’aura lieu." action={<Button to={`/guilds/${guildId}/modules`} variant="secondary" size="sm">Ouvrir Modules</Button>} />}
      {!guild?.gatewayConnected && <OperationalState kind="gateway" title="Gateway indisponible" description="Les événements Discord ne déclencheront pas le flux tant que le service reste hors ligne." available="Le brouillon peut toujours être enregistré." action={<Button to={`/guilds/${guildId}/health`} variant="secondary" size="sm">Voir le diagnostic</Button>} />}
      {visibleErrors && visibleErrors.blockingErrors.length > 0 && (
        <div id="automation-validation-summary" tabIndex={-1} role="alert" className="rounded-xl border border-red-800 bg-red-950/35 p-4">
          <p className="text-sm font-semibold text-red-200">Corrigez les erreurs suivantes :</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-300">{visibleErrors.blockingErrors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <EditorWorkspace
        mainDescription="Déclencheur, conditions puis actions dans l’ordre envoyé au serveur."
        railDescription="Résumé instantané, état réel, permissions et limites."
        main={
          <fieldset disabled={!editorEnabled} className="space-y-4">
            <Card title="Identité et garde-fous" description="Activation, cadence et limites d’exécution." pad="compact">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nom" error={visibleErrors?.fieldErrors.name}><Input value={workflow.name} maxLength={80} onChange={(event) => setWorkflow({ ...workflow, name: event.target.value })} /></Field>
                <Field label="Description" error={visibleErrors?.fieldErrors.description}><Input value={workflow.description} maxLength={500} onChange={(event) => setWorkflow({ ...workflow, description: event.target.value })} /></Field>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="flex items-center rounded-lg border border-zinc-800 px-3"><Toggle checked={workflow.enabled} onChange={(enabled) => setWorkflow({ ...workflow, enabled })} label="Active" /></div>
                <Field label="Cooldown (secondes)" error={visibleErrors?.fieldErrors.cooldownSeconds}><Input type="number" min={0} max={86400} value={workflow.cooldownSeconds} onChange={(event) => setWorkflow({ ...workflow, cooldownSeconds: Number(event.target.value) })} /></Field>
                <Field label="Portée"><Select value={workflow.cooldownScope} onChange={(event) => setWorkflow({ ...workflow, cooldownScope: event.target.value as AutomationWorkflowInput["cooldownScope"] })}><option value="user">Utilisateur</option><option value="channel">Salon</option><option value="guild">Serveur</option></Select></Field>
                <Field label="Maximum / minute" error={visibleErrors?.fieldErrors.maxRunsPerMinute}><Input type="number" min={1} max={60} value={workflow.maxRunsPerMinute} onChange={(event) => setWorkflow({ ...workflow, maxRunsPerMinute: Number(event.target.value) })} /></Field>
              </div>
            </Card>

            <Card title="Quand — Déclencheur" description="Un seul événement démarre le flux." pad="compact">
              <AutomationComponentCard kind="trigger" component={workflow.trigger as EditableComponent} catalog={definitions.triggers} roles={roles.data ?? []} channels={channels.data ?? []} count={1} errors={visibleErrors?.componentErrors ?? {}} onChange={(trigger) => setWorkflow({ ...workflow, trigger: trigger as AutomationWorkflowInput["trigger"] })} />
            </Card>

            <Card
              title={`Si — Conditions · ${workflow.conditions.length}/20`}
              description="Évaluées dans l’ordre avec le regroupement logique sélectionné."
              action={<Button type="button" variant="secondary" size="sm" disabled={workflow.conditions.length >= 20} onClick={() => { setWorkflow({ ...workflow, conditions: [...workflow.conditions, newComponent(definitions.conditions[0]!, "condition") as AutomationWorkflowInput["conditions"][number]] }); setAnnouncement("Condition ajoutée."); }}>+ Condition</Button>}
              pad="compact"
            >
              <Field label="Regroupement logique"><Select value={workflow.conditionMode} onChange={(event) => setWorkflow({ ...workflow, conditionMode: event.target.value as "all" | "any" })}><option value="all">Toutes (ET)</option><option value="any">Une au moins (OU)</option></Select></Field>
              <div className="mt-3 space-y-3">
                {workflow.conditions.map((condition, index) => (
                  <AutomationComponentCard key={condition.id ?? `${index}-${condition.type}`} index={index} kind="condition" component={condition as EditableComponent} catalog={definitions.conditions} roles={roles.data ?? []} channels={channels.data ?? []} count={workflow.conditions.length} errors={visibleErrors?.componentErrors ?? {}} onChange={(next) => setWorkflow({ ...workflow, conditions: workflow.conditions.map((item, itemIndex) => itemIndex === index ? next as AutomationWorkflowInput["conditions"][number] : item) })} onRemove={() => { setWorkflow({ ...workflow, conditions: workflow.conditions.filter((_, itemIndex) => itemIndex !== index) }); setAnnouncement(`Condition ${index + 1} supprimée.`); }} onMove={(delta) => moveComponent("condition", index, delta)} />
                ))}
                {workflow.conditions.length === 0 && <p className="rounded-lg border border-dashed border-zinc-700 px-3 py-5 text-center text-sm text-zinc-500">Aucune condition : chaque événement correspondant déclenchera les actions.</p>}
              </div>
            </Card>

            <Card
              title={`Alors — Actions · ${workflow.actions.length}/20`}
              description="Exécutées séquentiellement dans l’ordre affiché."
              action={<Button type="button" variant="secondary" size="sm" disabled={workflow.actions.length >= 20} onClick={() => { setWorkflow({ ...workflow, actions: [...workflow.actions, newComponent(definitions.actions[0]!, "action") as AutomationWorkflowInput["actions"][number]] }); setAnnouncement("Action ajoutée."); }}>+ Action</Button>}
              pad="compact"
            >
              <div className="space-y-3">
                {workflow.actions.map((action, index) => (
                  <AutomationComponentCard key={action.id ?? `${index}-${action.type}`} index={index} kind="action" component={action as EditableComponent} catalog={definitions.actions} roles={roles.data ?? []} channels={channels.data ?? []} count={workflow.actions.length} errors={visibleErrors?.componentErrors ?? {}} onChange={(next) => setWorkflow({ ...workflow, actions: workflow.actions.map((item, itemIndex) => itemIndex === index ? next as AutomationWorkflowInput["actions"][number] : item) })} onRemove={workflow.actions.length > 1 ? () => { setWorkflow({ ...workflow, actions: workflow.actions.filter((_, itemIndex) => itemIndex !== index) }); setAnnouncement(`Action ${index + 1} supprimée.`); } : undefined} onMove={(delta) => moveComponent("action", index, delta)} />
                ))}
              </div>
            </Card>
          </fieldset>
        }
        rail={
          <div className="space-y-3">
            <FlowSummary sentence={summary.sentence} steps={summary.steps} label="Résumé du flux" />
            <ModuleStatusPanel module={module} moduleLoading={modules.isPending} moduleError={modules.isError} gatewayConnected={guild?.gatewayConnected === true} canWrite={canWrite} configurationAllowed={configurationAllowed} enabled={workflow.enabled} targetChannel="" dirtyState={dirtyState} />
            <Card title="Limites du workflow" description="Contrat actuel, sans quota inventé." pad="compact">
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between"><dt className="text-zinc-500">Conditions</dt><dd className="tabular-nums text-zinc-200">{workflow.conditions.length}/20</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Actions</dt><dd className="tabular-nums text-zinc-200">{workflow.actions.length}/20</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Actions Attendre</dt><dd className="tabular-nums text-zinc-200">{workflow.actions.filter((action) => action.type === "wait").length}/5</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Exécutions / minute</dt><dd className="tabular-nums text-zinc-200">{workflow.maxRunsPerMinute}/60 max.</dd></div>
              </dl>
            </Card>
            <Card title="Permissions des actions" description="Dérivées du catalogue chargé." pad="compact">
              {summary.permissions.length
                ? <ul className="space-y-2 text-xs text-zinc-400">{summary.permissions.map((permission) => <li key={permission}>• {permission}</li>)}</ul>
                : <p className="text-xs text-zinc-500">Aucune permission supplémentaire déclarée.</p>}
            </Card>
            {validation.warnings.length > 0 && <Card title="Avertissements" pad="compact"><ul className="space-y-2 text-xs text-amber-200">{validation.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></Card>}
          </div>
        }
      />

      <DisclosureCard title="Variables de template" description="Référence fournie par le catalogue existant.">
        <div className="flex flex-wrap gap-2">{definitions.variables.map((variable) => <code key={variable} className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-indigo-300">{"{{"}{variable}{"}}"}</code>)}</div>
      </DisclosureCard>

      {isEditing && (
        <DisclosureCard open={showSimulation} onOpenChange={setShowSimulation} title="Simulation serveur existante" description="Test explicite et distinct du résumé local ; aucune mutation Discord ni D1.">
          <Textarea aria-label="Contexte JSON de simulation" className="font-mono text-xs" value={simulationJson} onChange={(event) => setSimulationJson(event.target.value)} />
          <div className="mt-3 flex justify-end"><Button variant="secondary" onClick={() => simulate.mutate()} loading={simulate.isPending}>Lancer la simulation</Button></div>
          {simulation && <div className="mt-4 rounded-lg bg-zinc-950 p-4 text-sm"><Badge tone={simulation.matched ? "success" : "warning"}>{simulation.matched ? "Conditions validées" : "Conditions non validées"}</Badge><ol className="mt-3 space-y-1 text-zinc-400">{simulation.actions.map((action, index) => <li key={`${action.type}-${index}`}>{index + 1}. {action.preview}</li>)}</ol>{simulation.warnings.map((warning) => <p key={warning} className="mt-2 text-amber-300">{warning}</p>)}</div>}
        </DisclosureCard>
      )}
      {isEditing && (
        <DisclosureCard open={showHistory} onOpenChange={setShowHistory} title="Historique" description="Révisions immuables de cette automatisation.">
          <div className="space-y-2">{revisions.isPending ? <SkeletonList rows={3} /> : (revisions.data ?? []).map((revision) => <div key={revision.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2 text-sm"><span>Révision {revision.revision} · {revision.changeType}</span><span className="text-zinc-500">{new Date(revision.createdAt).toLocaleString("fr-FR")}</span></div>)}</div>
        </DisclosureCard>
      )}

      <SaveBar
        dirty={dirty}
        status={status}
        onSave={requestSave}
        onReset={() => { setWorkflow(toAutomationInput(baseline)); setShowValidation(false); save.reset(); }}
        showWhenClean
        cleanLabel={isEditing ? "Automatisation enregistrée" : "Nouvelle automatisation"}
        actionLabel={isEditing ? "Enregistrer" : "Créer l’automatisation"}
        pendingLabel="Enregistrement en cours"
        successLabel="✓ Automatisation enregistrée"
        errorMessage={saveErrorMessage(save.error)}
        actionDisabled={!editorEnabled}
      />
    </div>
  );
}
