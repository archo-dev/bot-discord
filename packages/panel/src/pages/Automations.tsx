import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AutomationExecutionDto,
  AutomationExportEnvelope,
  AutomationStatsDto,
  AutomationWorkflowDto,
  GuildModulesResponse,
} from "@bot/shared";
import { api } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { Badge, Button, Card, EmptyState, Input, Select, StatCard, Toggle, Toolbar } from "../ui/kit.js";
import { ConfirmModal } from "../ui/overlay.js";
import { SkeletonList } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";

const statusTone = (status: AutomationExecutionDto["status"]) =>
  status === "succeeded" ? "success" : status === "failed" ? "danger" : status === "running" ? "primary" : "neutral";

export function AutomationsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const importRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"all" | "enabled" | "disabled">("all");
  const [trigger, setTrigger] = useState("all");
  const [toDelete, setToDelete] = useState<AutomationWorkflowDto | null>(null);

  const workflows = useQuery({
    queryKey: ["automations", guildId],
    queryFn: () => api<AutomationWorkflowDto[]>(`/api/guilds/${guildId}/automations`),
  });
  const stats = useQuery({
    queryKey: ["automation-stats", guildId],
    queryFn: () => api<AutomationStatsDto>(`/api/guilds/${guildId}/automations/stats`),
  });
  const executions = useQuery({
    queryKey: ["automation-executions", guildId],
    queryFn: () => api<AutomationExecutionDto[]>(`/api/guilds/${guildId}/automations/executions`),
    refetchInterval: 30_000,
  });
  const modules = useQuery({
    queryKey: ["modules", guildId],
    queryFn: () => api<GuildModulesResponse>(`/api/guilds/${guildId}/modules`),
  });
  const automationModule = modules.data?.modules.find((module) => module.id === "automations");
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["automations", guildId] });
    void queryClient.invalidateQueries({ queryKey: ["automation-stats", guildId] });
    void queryClient.invalidateQueries({ queryKey: ["automation-executions", guildId] });
  };

  const toggle = useMutation({
    mutationFn: (workflow: AutomationWorkflowDto) => api(`/api/guilds/${guildId}/automations/${workflow.id}/state`, {
      method: "PATCH", body: JSON.stringify({ enabled: !workflow.enabled }),
    }),
    onSuccess: (_data, workflow) => { invalidate(); toast.success(`${workflow.name} ${workflow.enabled ? "désactivée" : "activée"}`); },
  });
  const duplicate = useMutation({
    mutationFn: (workflow: AutomationWorkflowDto) => api<AutomationWorkflowDto>(`/api/guilds/${guildId}/automations/${workflow.id}/duplicate`, { method: "POST" }),
    onSuccess: (copy) => { invalidate(); toast.success("Automatisation dupliquée"); void navigate(`/guilds/${guildId}/automations/${copy.id}`); },
  });
  const remove = useMutation({
    mutationFn: (workflow: AutomationWorkflowDto) => api<void>(`/api/guilds/${guildId}/automations/${workflow.id}`, { method: "DELETE" }),
    onSuccess: (_data, workflow) => { invalidate(); setToDelete(null); toast.success(`${workflow.name} supprimée`); },
  });
  const importWorkflow = useMutation({
    mutationFn: (envelope: AutomationExportEnvelope) => api<AutomationWorkflowDto>(`/api/guilds/${guildId}/automations/import`, { method: "POST", body: JSON.stringify(envelope) }),
    onSuccess: (workflow) => { invalidate(); toast.success("Import validé et créé"); void navigate(`/guilds/${guildId}/automations/${workflow.id}`); },
    onError: () => toast.error("Fichier d’automatisation invalide."),
  });

  const triggerTypes = useMemo(() => [...new Set((workflows.data ?? []).map((workflow) => workflow.trigger.type))], [workflows.data]);
  const filtered = useMemo(() => (workflows.data ?? []).filter((workflow) => {
    const matchesSearch = `${workflow.name} ${workflow.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
    const matchesState = state === "all" || (state === "enabled" ? workflow.enabled : !workflow.enabled);
    return matchesSearch && matchesState && (trigger === "all" || workflow.trigger.type === trigger);
  }), [workflows.data, search, state, trigger]);

  async function readImport(file: File | undefined) {
    if (!file) return;
    try {
      const envelope = JSON.parse(await file.text()) as AutomationExportEnvelope;
      const validation = await api<{ valid: boolean }>(`/api/guilds/${guildId}/automations/import/validate`, { method: "POST", body: JSON.stringify(envelope) });
      if (!validation.valid) throw new Error("invalid");
      importWorkflow.mutate(envelope);
    } catch { toast.error("Le fichier ne respecte pas le format d’export M10."); }
    finally { if (importRef.current) importRef.current.value = ""; }
  }

  async function exportWorkflow(workflow: AutomationWorkflowDto) {
    const envelope = await api<AutomationExportEnvelope>(`/api/guilds/${guildId}/automations/${workflow.id}/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `automation-${workflow.name.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`; anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <Toolbar actions={canWrite ? <div className="flex gap-2">
        <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void readImport(event.target.files?.[0])} />
        <Button variant="secondary" onClick={() => importRef.current?.click()} loading={importWorkflow.isPending}>Importer</Button>
        <Link to="new" className="inline-flex h-10 items-center rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-4 text-sm font-semibold text-white shadow-(--shadow-primary)">+ Nouvelle automatisation</Link>
      </div> : undefined}>
        <p className="text-sm text-zinc-400">Créez des scénarios SI… ALORS… sans code.</p>
      </Toolbar>

      {automationModule && !automationModule.enabled && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-800/70 bg-amber-950/30 p-4 text-sm text-amber-200"><span>Le module Studio d’automatisations est désactivé : les définitions sont conservées, mais aucune ne sera exécutée.</span><Link to="../modules" className="font-semibold text-amber-100 underline">Ouvrir Modules</Link></div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Icon.workflow />} value={stats.data?.executions ?? "—"} label="Exécutions sur 30 jours" />
        <StatCard icon={<Icon.bolt />} color="green" value={stats.data?.successes ?? "—"} label="Succès" />
        <StatCard icon={<Icon.shield />} color="red" value={stats.data?.failures ?? "—"} label="Échecs" />
        <StatCard icon={<Icon.pulse />} color="blue" value={stats.data?.averageDurationMs == null ? "—" : `${stats.data.averageDurationMs} ms`} label="Durée moyenne" />
      </div>

      <Card pad="compact">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_220px]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher par nom ou description…" aria-label="Rechercher" />
          <Select value={state} onChange={(event) => setState(event.target.value as typeof state)} aria-label="Filtrer par état">
            <option value="all">Tous les états</option><option value="enabled">Actives</option><option value="disabled">Inactives</option>
          </Select>
          <Select value={trigger} onChange={(event) => setTrigger(event.target.value)} aria-label="Filtrer par déclencheur">
            <option value="all">Tous les déclencheurs</option>{triggerTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </Select>
        </div>
      </Card>

      {workflows.isPending && <Card><SkeletonList rows={5} /></Card>}
      {!workflows.isPending && filtered.length === 0 && <Card><EmptyState icon={<Icon.workflow />} title="Aucune automatisation" description={workflows.data?.length ? "Aucun scénario ne correspond aux filtres." : "Créez votre premier scénario visuel."} /></Card>}
      <div className="space-y-3">
        {filtered.map((workflow) => <Card key={workflow.id} pad="compact">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={workflow.id} className="font-semibold text-zinc-100 hover:text-indigo-300">{workflow.name}</Link>
                <Badge tone={workflow.enabled ? "success" : "neutral"}>{workflow.enabled ? "active" : "inactive"}</Badge>
                <Badge tone="primary">{workflow.trigger.type}</Badge>
                {workflow.circuitOpenUntil && <Badge tone="danger">circuit ouvert</Badge>}
              </div>
              <p className="mt-1 truncate text-sm text-zinc-400">{workflow.description || "Sans description"}</p>
              <p className="mt-1 text-xs text-zinc-500">{workflow.conditions.length} condition(s) · {workflow.actions.length} action(s) · révision {workflow.revision}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={!canWrite ? "pointer-events-none opacity-50" : undefined}><Toggle checked={workflow.enabled} onChange={() => canWrite && toggle.mutate(workflow)} /></span>
              <Link to={workflow.id} className="inline-flex h-8 items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[13px] font-medium text-zinc-100 hover:bg-zinc-700">{canWrite ? "Modifier" : "Voir"}</Link>
              <Button size="sm" variant="ghost" onClick={() => void exportWorkflow(workflow)}>Exporter</Button>
              {canWrite && <><Button size="sm" variant="secondary" onClick={() => duplicate.mutate(workflow)}>Dupliquer</Button><Button size="sm" variant="ghost" className="text-red-400" onClick={() => setToDelete(workflow)}>Supprimer</Button></>}
            </div>
          </div>
        </Card>)}
      </div>

      <Card title="Exécutions récentes" description="Journal corrélé des 100 dernières exécutions.">
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="text-xs uppercase text-zinc-500"><tr><th className="pb-3">Workflow</th><th>État</th><th>Actions</th><th>Durée</th><th>Début</th><th>Corrélation</th></tr></thead><tbody className="divide-y divide-zinc-800">
          {(executions.data ?? []).slice(0, 12).map((execution) => <tr key={execution.id}><td className="py-3 text-zinc-200">{execution.workflowName}</td><td><Badge tone={statusTone(execution.status)}>{execution.status}</Badge></td><td className="text-zinc-400">{execution.actionsSucceeded}/{execution.actionsTotal}</td><td className="text-zinc-400">{execution.durationMs == null ? "—" : `${execution.durationMs} ms`}</td><td className="text-zinc-400">{new Date(execution.startedAt).toLocaleString("fr-FR")}</td><td><code className="text-xs text-zinc-500">{execution.correlationId.slice(0, 8)}</code></td></tr>)}
          {executions.data?.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-zinc-500">Aucune exécution enregistrée.</td></tr>}
        </tbody></table></div>
      </Card>

      <ConfirmModal open={toDelete !== null} title="Supprimer l’automatisation" subject={<>Supprimer <b>{toDelete?.name}</b> ?</>} consequence="Les exécutions planifiées en attente seront annulées. L’historique de révisions reste disponible pour l’audit." loading={remove.isPending} onCancel={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete)} />
    </div>
  );
}
