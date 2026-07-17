import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
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
  RoleOption,
} from "@bot/shared";
import { api, ApiError } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { Badge, Button, Card, Field, Input, Select, Textarea, Toggle } from "../ui/kit.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";

type EditableComponent = { id?: string; type: string; config: Record<string, unknown>; negate?: boolean; continueOnError?: boolean };
type CatalogItem = AutomationComponentDefinition<string>;

const emptyWorkflow: AutomationWorkflowInput = {
  schemaVersion: 1,
  name: "",
  description: "",
  enabled: false,
  trigger: { type: "message_create", config: { ignoreBots: true } },
  conditions: [],
  conditionMode: "all",
  actions: [{ type: "send_message", config: { content: "" }, continueOnError: false }],
  cooldownSeconds: 0,
  cooldownScope: "user",
  maxRunsPerMinute: 10,
};

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
  return { id: crypto.randomUUID(), type: definition.id, config, ...(kind === "condition" ? { negate: false } : {}), ...(kind === "action" ? { continueOnError: false } : {}) };
}

function ComponentFields({ definition, component, roles, channels, onChange }: {
  definition: CatalogItem;
  component: EditableComponent;
  roles: RoleOption[];
  channels: ChannelOption[];
  onChange: (next: EditableComponent) => void;
}) {
  const setConfig = (key: string, value: unknown) => onChange({ ...component, config: { ...component.config, [key]: value } });
  return <div className="grid gap-3 md:grid-cols-2">
    {definition.configFields.map((field) => {
      const value = component.config[field.key];
      const label = <>{field.label}{field.required ? <span className="text-red-400"> *</span> : null}</>;
      if (field.type === "boolean") return <div key={field.key} className="flex items-end pb-2"><Toggle checked={value === true} onChange={(checked) => setConfig(field.key, checked)} label={field.label} /></div>;
      if (field.type === "role") return <Field key={field.key} label={label}><Select value={String(value ?? "")} onChange={(event) => setConfig(field.key, event.target.value)}><option value="">Rôle du contexte</option>{roles.filter((role) => !role.managed).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</Select></Field>;
      if (field.type === "channel") return <Field key={field.key} label={label}><Select value={String(value ?? "")} onChange={(event) => setConfig(field.key, event.target.value)}><option value="">Salon du contexte</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</Select></Field>;
      if (field.type === "select") return <Field key={field.key} label={label}><Select value={String(value ?? "")} onChange={(event) => setConfig(field.key, event.target.value)}>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</Select></Field>;
      if (field.type === "textarea") return <Field key={field.key} label={label}><Textarea className="min-h-24" value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => setConfig(field.key, event.target.value)} /></Field>;
      if (field.type === "json") return <Field key={field.key} label={label} hint="JSON valide"><Textarea className="min-h-24 font-mono text-xs" value={typeof value === "string" ? value : JSON.stringify(value, null, 2)} onChange={(event) => setConfig(field.key, event.target.value)} onBlur={(event) => { try { setConfig(field.key, JSON.parse(event.target.value)); } catch { /* la validation serveur signalera le JSON invalide */ } }} /></Field>;
      return <Field key={field.key} label={label}><Input type={field.type === "number" ? "number" : "text"} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => setConfig(field.key, field.type === "number" ? Number(event.target.value) : event.target.value)} /></Field>;
    })}
  </div>;
}

function ComponentCard({ index, kind, component, catalog, roles, channels, count, onChange, onRemove, onMove }: {
  index?: number;
  kind: "trigger" | "condition" | "action";
  component: EditableComponent;
  catalog: readonly CatalogItem[];
  roles: RoleOption[];
  channels: ChannelOption[];
  count: number;
  onChange: (next: EditableComponent) => void;
  onRemove?: () => void;
  onMove?: (delta: -1 | 1) => void;
}) {
  const definition = catalog.find((entry) => entry.id === component.type) ?? catalog[0];
  if (!definition) return null;
  const changeType = (type: string) => { const next = catalog.find((entry) => entry.id === type); if (next) onChange(newComponent(next, kind)); };
  return <div className="rounded-xl border border-zinc-800 bg-zinc-950/55 p-4">
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {index !== undefined && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-300">{index + 1}</span>}
      <Select className="max-w-sm" value={component.type} onChange={(event) => changeType(event.target.value)}>
        {catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </Select>
      <Badge tone="neutral">{definition.category}</Badge>
      {definition.requiredPermissions.length > 0 && <Badge tone="warning">{definition.requiredPermissions.join(", ")}</Badge>}
      <div className="ml-auto flex gap-1">
        {kind === "condition" && <Toggle checked={component.negate === true} onChange={(negate) => onChange({ ...component, negate })} label="Inverser" />}
        {kind === "action" && <Toggle checked={component.continueOnError === true} onChange={(continueOnError) => onChange({ ...component, continueOnError })} label="Continuer si erreur" />}
        {onMove && <><Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Monter">↑</Button><Button type="button" size="sm" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Descendre">↓</Button></>}
        {onRemove && <Button type="button" size="sm" variant="ghost" className="text-red-400" onClick={onRemove}>Retirer</Button>}
      </div>
    </div>
    <p className="mb-4 text-sm text-zinc-400">{definition.description}</p>
    <ComponentFields definition={definition} component={component} roles={roles} channels={channels} onChange={onChange} />
  </div>;
}

export function AutomationEditorPage() {
  const { guildId, automationId } = useParams<{ guildId: string; automationId?: string }>();
  const isEditing = automationId !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [workflow, setWorkflow] = useState<AutomationWorkflowInput>(emptyWorkflow);
  const [error, setError] = useState<string | null>(null);
  const [simulationJson, setSimulationJson] = useState("");
  const [simulation, setSimulation] = useState<AutomationSimulationResult | null>(null);

  const catalog = useQuery({ queryKey: ["automation-catalog", guildId], queryFn: () => api<AutomationCatalogDto>(`/api/guilds/${guildId}/automations/catalog`) });
  const existing = useQuery({ queryKey: ["automation", guildId, automationId], queryFn: () => api<AutomationWorkflowDto>(`/api/guilds/${guildId}/automations/${automationId}`), enabled: isEditing });
  const roles = useQuery({ queryKey: ["roles", guildId], queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`) });
  const channels = useQuery({ queryKey: ["channels", guildId], queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`) });
  const revisions = useQuery({ queryKey: ["automation-revisions", guildId, automationId], queryFn: () => api<AutomationRevisionDto[]>(`/api/guilds/${guildId}/automations/${automationId}/revisions`), enabled: isEditing });

  useEffect(() => { if (existing.data) setWorkflow(existing.data); }, [existing.data]);
  useEffect(() => {
    setSimulationJson(JSON.stringify({ event: { type: workflow.trigger.type, id: "panel-simulation", depth: 0 }, guild: { id: guildId } }, null, 2));
  }, [guildId, workflow.trigger.type]);

  const save = useMutation({
    mutationFn: () => api<AutomationWorkflowDto>(isEditing ? `/api/guilds/${guildId}/automations/${automationId}` : `/api/guilds/${guildId}/automations`, { method: isEditing ? "PUT" : "POST", body: JSON.stringify(workflow) }),
    onSuccess: (saved) => { void queryClient.invalidateQueries({ queryKey: ["automations", guildId] }); toast.success(isEditing ? "Automatisation enregistrée" : "Automatisation créée"); void navigate(`/guilds/${guildId}/automations/${saved.id}`); },
    onError: (cause) => setError(cause instanceof ApiError && cause.code === "duplicate_name" ? "Une automatisation porte déjà ce nom." : "La configuration est invalide. Vérifiez les champs requis et les valeurs JSON."),
  });
  const simulate = useMutation({
    mutationFn: () => api<AutomationSimulationResult>(`/api/guilds/${guildId}/automations/${automationId}/simulate`, { method: "POST", body: JSON.stringify(JSON.parse(simulationJson) as AutomationEventContext) }),
    onSuccess: (result) => setSimulation(result),
    onError: () => toast.error("Contexte de simulation invalide."),
  });

  const definitions = catalog.data;
  const move = <T,>(items: T[], index: number, delta: -1 | 1): T[] => { const next = [...items]; const target = index + delta; if (target < 0 || target >= next.length) return next; [next[index], next[target]] = [next[target]!, next[index]!]; return next; };
  const preview = useMemo(() => `${definitions?.triggers.find((item) => item.id === workflow.trigger.type)?.name ?? workflow.trigger.type} → ${workflow.actions.map((action) => definitions?.actions.find((item) => item.id === action.type)?.name ?? action.type).join(" → ")}`, [definitions, workflow]);

  if (!definitions || (isEditing && existing.isPending)) return <SkeletonSettingsPage cards={4} />;

  return <div className="mx-auto max-w-5xl space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><Link to=".." className="text-sm text-indigo-300 hover:text-indigo-200">← Studio</Link><h2 className="mt-1 text-xl font-semibold text-zinc-100">{isEditing ? workflow.name || "Automatisation" : "Nouvelle automatisation"}</h2></div>
      <div className="flex gap-2">{isEditing && <Button variant="secondary" onClick={() => simulate.mutate()} loading={simulate.isPending}>Mode test</Button>}<Button onClick={() => { setError(null); save.mutate(); }} loading={save.isPending} disabled={!canWrite || workflow.name.trim() === "" || workflow.actions.length === 0}>{isEditing ? "Enregistrer" : "Créer"}</Button></div>
    </div>

    {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/35 p-4 text-sm text-red-300">{error}</div>}
    <Card title="Aperçu du scénario"><p className="font-mono text-sm text-indigo-200">SI {preview}</p></Card>

    <fieldset disabled={!canWrite} className="space-y-6">
      <Card title="Identité et garde-fous" description="Les limites s’appliquent atomiquement avant toute action.">
        <div className="grid gap-4 md:grid-cols-2"><Field label="Nom"><Input value={workflow.name} maxLength={80} onChange={(event) => setWorkflow({ ...workflow, name: event.target.value })} /></Field><Field label="Description"><Input value={workflow.description} maxLength={500} onChange={(event) => setWorkflow({ ...workflow, description: event.target.value })} /></Field></div>
        <div className="mt-4 grid gap-4 md:grid-cols-4"><Toggle checked={workflow.enabled} onChange={(enabled) => setWorkflow({ ...workflow, enabled })} label="Active" /><Field label="Cooldown (secondes)"><Input type="number" min={0} max={86400} value={workflow.cooldownSeconds} onChange={(event) => setWorkflow({ ...workflow, cooldownSeconds: Number(event.target.value) })} /></Field><Field label="Portée"><Select value={workflow.cooldownScope} onChange={(event) => setWorkflow({ ...workflow, cooldownScope: event.target.value as AutomationWorkflowInput["cooldownScope"] })}><option value="user">Utilisateur</option><option value="channel">Salon</option><option value="guild">Serveur</option></Select></Field><Field label="Maximum / minute"><Input type="number" min={1} max={60} value={workflow.maxRunsPerMinute} onChange={(event) => setWorkflow({ ...workflow, maxRunsPerMinute: Number(event.target.value) })} /></Field></div>
      </Card>

      <Card title="SI — Déclencheur" description="Un seul événement démarre ce scénario.">
        <ComponentCard kind="trigger" component={workflow.trigger as EditableComponent} catalog={definitions.triggers} roles={roles.data ?? []} channels={channels.data ?? []} count={1} onChange={(trigger) => setWorkflow({ ...workflow, trigger: trigger as AutomationWorkflowInput["trigger"] })} />
      </Card>

      <Card title="ET / OU — Conditions" description="Les conditions sont évaluées sans eval, dans l’ordre affiché." action={<div className="flex gap-2"><Select value={workflow.conditionMode} onChange={(event) => setWorkflow({ ...workflow, conditionMode: event.target.value as "all" | "any" })}><option value="all">Toutes (ET)</option><option value="any">Une au moins (OU)</option></Select><Button type="button" variant="secondary" disabled={workflow.conditions.length >= 20} onClick={() => setWorkflow({ ...workflow, conditions: [...workflow.conditions, newComponent(definitions.conditions[0]!, "condition") as AutomationWorkflowInput["conditions"][number]] })}>+ Condition</Button></div>}>
        <div className="space-y-3">{workflow.conditions.map((condition, index) => <ComponentCard key={condition.id ?? index} index={index} kind="condition" component={condition as EditableComponent} catalog={definitions.conditions} roles={roles.data ?? []} channels={channels.data ?? []} count={workflow.conditions.length} onChange={(next) => setWorkflow({ ...workflow, conditions: workflow.conditions.map((item, itemIndex) => itemIndex === index ? next as AutomationWorkflowInput["conditions"][number] : item) })} onRemove={() => setWorkflow({ ...workflow, conditions: workflow.conditions.filter((_, itemIndex) => itemIndex !== index) })} onMove={(delta) => setWorkflow({ ...workflow, conditions: move(workflow.conditions, index, delta) })} />)}{workflow.conditions.length === 0 && <p className="py-4 text-center text-sm text-zinc-500">Aucune condition : chaque événement correspondant déclenchera le workflow.</p>}</div>
      </Card>

      <Card title="ALORS — Actions" description="Les actions sont séquentielles ; Attendre planifie la suite sans bloquer le Worker." action={<Button type="button" variant="secondary" disabled={workflow.actions.length >= 20} onClick={() => setWorkflow({ ...workflow, actions: [...workflow.actions, newComponent(definitions.actions[0]!, "action") as AutomationWorkflowInput["actions"][number]] })}>+ Action</Button>}>
        <div className="space-y-3">{workflow.actions.map((action, index) => <ComponentCard key={action.id ?? index} index={index} kind="action" component={action as EditableComponent} catalog={definitions.actions} roles={roles.data ?? []} channels={channels.data ?? []} count={workflow.actions.length} onChange={(next) => setWorkflow({ ...workflow, actions: workflow.actions.map((item, itemIndex) => itemIndex === index ? next as AutomationWorkflowInput["actions"][number] : item) })} onRemove={workflow.actions.length > 1 ? () => setWorkflow({ ...workflow, actions: workflow.actions.filter((_, itemIndex) => itemIndex !== index) }) : undefined} onMove={(delta) => setWorkflow({ ...workflow, actions: move(workflow.actions, index, delta) })} />)}</div>
      </Card>
    </fieldset>

    <Card title="Variables de template" description="Utilisables dans tous les champs texte sous la forme {{variable}}."><div className="flex flex-wrap gap-2">{definitions.variables.map((variable) => <code key={variable} className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-indigo-300">{"{{"}{variable}{"}}"}</code>)}</div></Card>

    {isEditing && <Card title="Simulation" description="Le mode test évalue les conditions et prévisualise les actions sans aucune mutation Discord ou D1 métier."><Textarea className="font-mono text-xs" value={simulationJson} onChange={(event) => setSimulationJson(event.target.value)} />{simulation && <div className="mt-4 rounded-lg bg-zinc-950 p-4 text-sm"><Badge tone={simulation.matched ? "success" : "warning"}>{simulation.matched ? "conditions validées" : "conditions non validées"}</Badge><ul className="mt-3 space-y-1 text-zinc-400">{simulation.actions.map((action, index) => <li key={`${action.type}-${index}`}>{index + 1}. {action.preview}</li>)}</ul>{simulation.warnings.map((warning) => <p key={warning} className="mt-2 text-amber-300">{warning}</p>)}</div>}</Card>}

    {isEditing && <Card title="Historique" description="Chaque modification, activation, désactivation ou import produit une révision immuable."><div className="space-y-2">{(revisions.data ?? []).map((revision) => <div key={revision.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2 text-sm"><span>Révision {revision.revision} · {revision.changeType}</span><span className="text-zinc-500">{new Date(revision.createdAt).toLocaleString("fr-FR")}</span></div>)}</div></Card>}
  </div>;
}
