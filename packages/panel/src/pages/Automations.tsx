import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router";
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
import { Badge, Button, Card, EmptyState, ErrorCard, Input, Select, Toggle, Toolbar } from "../ui/kit.js";
import { ConfirmModal } from "../ui/overlay.js";
import { SkeletonList } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { ContextMenu, MenuItem } from "../ui/menu.js";
import { TimeAgo } from "../ui/mod-meta.js";
import type { GuildOutletContext } from "./GuildLayout.js";

const statusTone = (status: AutomationExecutionDto["status"]) =>
  status === "succeeded" ? "success" : status === "failed" ? "danger" : status === "running" ? "primary" : "neutral";

export function AutomationsPage() {
  const { guildId = "" } = useParams<{ guildId: string }>();
  const { guild } = useOutletContext<GuildOutletContext>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const importRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"all" | "enabled" | "disabled">("all");
  const [trigger, setTrigger] = useState("all");
  const [showExecutions, setShowExecutions] = useState(false);
  const [toDelete, setToDelete] = useState<AutomationWorkflowDto | null>(null);

  const workflows = useQuery({
    queryKey: ["automations", guildId],
    queryFn: ({ signal }) => api<AutomationWorkflowDto[]>(`/api/guilds/${guildId}/automations`, { signal }),
  });
  const stats = useQuery({
    queryKey: ["automation-stats", guildId],
    queryFn: ({ signal }) => api<AutomationStatsDto>(`/api/guilds/${guildId}/automations/stats`, { signal }),
  });
  const executions = useQuery({
    queryKey: ["automation-executions", guildId],
    queryFn: ({ signal }) => api<AutomationExecutionDto[]>(`/api/guilds/${guildId}/automations/executions`, { signal }),
    enabled: showExecutions,
    refetchInterval: 30_000,
  });
  const modules = useQuery({
    queryKey: ["modules", guildId],
    queryFn: ({ signal }) => api<GuildModulesResponse>(`/api/guilds/${guildId}/modules`, { signal }),
    staleTime: 60_000,
  });
  const module = modules.data?.modules.find((candidate) => candidate.id === "automations");
  const configurationAllowed = module?.actions.canConfigure ?? !modules.isError;
  const canChange = canWrite && configurationAllowed && modules.isSuccess;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["automations", guildId] });
    void queryClient.invalidateQueries({ queryKey: ["automation-stats", guildId] });
    void queryClient.invalidateQueries({ queryKey: ["automation-executions", guildId] });
  };
  const toggle = useMutation({
    mutationFn: (workflow: AutomationWorkflowDto) =>
      api(`/api/guilds/${guildId}/automations/${workflow.id}/state`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !workflow.enabled }),
      }),
    onSuccess: (_data, workflow) => {
      invalidate();
      toast.success(`${workflow.name} ${workflow.enabled ? "désactivée" : "activée"}`);
    },
  });
  const duplicate = useMutation({
    mutationFn: (workflow: AutomationWorkflowDto) =>
      api<AutomationWorkflowDto>(`/api/guilds/${guildId}/automations/${workflow.id}/duplicate`, { method: "POST" }),
    onSuccess: (copy) => {
      invalidate();
      toast.success("Automatisation dupliquée");
      void navigate(`/guilds/${guildId}/automations/${copy.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (workflow: AutomationWorkflowDto) =>
      api<void>(`/api/guilds/${guildId}/automations/${workflow.id}`, { method: "DELETE" }),
    onSuccess: (_data, workflow) => {
      invalidate();
      setToDelete(null);
      toast.success(`${workflow.name} supprimée`);
    },
  });
  const importWorkflow = useMutation({
    mutationFn: (envelope: AutomationExportEnvelope) =>
      api<AutomationWorkflowDto>(`/api/guilds/${guildId}/automations/import`, { method: "POST", body: JSON.stringify(envelope) }),
    meta: { silentError: true },
    onSuccess: (workflow) => {
      invalidate();
      toast.success("Import validé et créé");
      void navigate(`/guilds/${guildId}/automations/${workflow.id}`);
    },
    onError: () => toast.error("Fichier d’automatisation invalide."),
  });

  const triggerTypes = useMemo(
    () => [...new Set((workflows.data ?? []).map((workflow) => workflow.trigger.type))],
    [workflows.data],
  );
  const filtered = useMemo(() => (workflows.data ?? []).filter((workflow) => {
    const normalized = search.toLocaleLowerCase().trim();
    const matchesSearch = !normalized || `${workflow.name} ${workflow.description}`.toLocaleLowerCase().includes(normalized);
    const matchesState = state === "all" || (state === "enabled" ? workflow.enabled : !workflow.enabled);
    return matchesSearch && matchesState && (trigger === "all" || workflow.trigger.type === trigger);
  }), [workflows.data, search, state, trigger]);
  const filtersActive = Boolean(search || state !== "all" || trigger !== "all");
  const resetFilters = () => { setSearch(""); setState("all"); setTrigger("all"); };

  async function readImport(file: File | undefined) {
    if (!file) return;
    try {
      const envelope = JSON.parse(await file.text()) as AutomationExportEnvelope;
      const validation = await api<{ valid: boolean }>(`/api/guilds/${guildId}/automations/import/validate`, {
        method: "POST",
        body: JSON.stringify(envelope),
      });
      if (!validation.valid) throw new Error("invalid");
      importWorkflow.mutate(envelope);
    } catch {
      toast.error("Le fichier ne respecte pas le format d’export M10.");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }
  async function exportWorkflow(workflow: AutomationWorkflowDto) {
    const envelope = await api<AutomationExportEnvelope>(`/api/guilds/${guildId}/automations/${workflow.id}/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `automation-${workflow.name.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const WorkflowActions = ({ workflow }: { workflow: AutomationWorkflowDto }) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canChange ? (
        <Toggle ariaLabel={`${workflow.enabled ? "Désactiver" : "Activer"} ${workflow.name}`} checked={workflow.enabled} onChange={() => { if (!toggle.isPending) toggle.mutate(workflow); }} />
      ) : (
        <Badge tone="neutral">Lecture seule</Badge>
      )}
      <Link to={workflow.id} className="inline-flex h-8 items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[13px] font-medium text-zinc-100 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">
        {canChange ? "Modifier" : "Voir"}
      </Link>
      <ContextMenu label={`Actions pour ${workflow.name}`}>
        <MenuItem onClick={() => void exportWorkflow(workflow)}>Exporter</MenuItem>
        {canChange && <MenuItem onClick={() => duplicate.mutate(workflow)}>Dupliquer</MenuItem>}
        {canChange && <MenuItem danger onClick={() => setToDelete(workflow)}>Supprimer</MenuItem>}
      </ContextMenu>
    </div>
  );

  return (
    <div className="min-w-0 space-y-4">
      <Toolbar
        actions={canChange ? (
          <div className="flex flex-wrap gap-2">
            <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void readImport(event.target.files?.[0])} />
            <Button variant="secondary" onClick={() => importRef.current?.click()} loading={importWorkflow.isPending}>Importer</Button>
            <Button to="new">Créer une automatisation</Button>
          </div>
        ) : undefined}
      >
        <div>
          <p className="text-sm font-medium text-zinc-200">Automatisations</p>
          <p className="mt-0.5 text-xs text-zinc-500">{workflows.data ? `${workflows.data.length} workflow(s)` : "Chargement…"}</p>
        </div>
      </Toolbar>

      {modules.isError && (
        <ErrorCard
          compact
          title="Capacités du module indisponibles"
          message="Les automatisations restent consultables, mais les actions d’écriture sont neutralisées tant que les capacités ne sont pas chargées."
          onRetry={() => void modules.refetch()}
          retrying={modules.isFetching}
        />
      )}
      {stats.isError && (
        <ErrorCard
          compact
          title="Statistiques indisponibles"
          message="Impossible de charger l’activité sur 30 jours. La liste et ses actions restent disponibles."
          onRetry={() => void stats.refetch()}
          retrying={stats.isFetching}
        />
      )}
      {!canWrite && <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-sm text-amber-200">Lecture seule : les automatisations et leurs exports restent consultables.</div>}
      {canWrite && !configurationAllowed && <div role="alert" className="rounded-xl border border-red-900/60 bg-red-950/25 px-3 py-2.5 text-sm text-red-200">Permission insuffisante : création, import, duplication, activation et suppression indisponibles.</div>}
      {module && !module.enabled && <div role="status" className="rounded-xl border border-zinc-700 bg-zinc-900/70 px-3 py-2.5 text-sm text-zinc-300">Module désactivé : les définitions sont conservées, mais aucune ne sera exécutée.</div>}
      {!guild?.gatewayConnected && <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-sm text-amber-200">Gateway indisponible : les événements Discord ne déclencheront pas les automatisations.</div>}

      <Card pad="compact" title="Activité · 30 jours" action={<Button size="sm" variant="ghost" onClick={() => setShowExecutions((value) => !value)}>{showExecutions ? "Masquer le journal" : "Voir le journal"}</Button>}>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-4">
          {[
            ["Exécutions", stats.data?.executions ?? "—"],
            ["Succès", stats.data?.successes ?? "—"],
            ["Échecs", stats.data?.failures ?? "—"],
            ["Durée moyenne", stats.data?.averageDurationMs == null ? "—" : `${stats.data.averageDurationMs} ms`],
          ].map(([label, value]) => (
            <div key={label} className="bg-zinc-950/70 px-3 py-2">
              <dt className="text-[11px] text-zinc-500">{label}</dt><dd className="mt-0.5 text-lg font-bold text-zinc-100">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card pad="compact">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_220px]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher par nom ou description…" aria-label="Rechercher une automatisation" />
          <Select value={state} onChange={(event) => setState(event.target.value as typeof state)} aria-label="Filtrer les automatisations par état">
            <option value="all">Tous les états</option><option value="enabled">Actives</option><option value="disabled">Inactives</option>
          </Select>
          <Select value={trigger} onChange={(event) => setTrigger(event.target.value)} aria-label="Filtrer les automatisations par déclencheur">
            <option value="all">Tous les déclencheurs</option>{triggerTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </Select>
        </div>
      </Card>

      {workflows.isPending && <Card><SkeletonList rows={5} /></Card>}
      {workflows.isError && <ErrorCard message="Impossible de charger les automatisations." onRetry={() => void workflows.refetch()} />}
      {!workflows.isPending && !workflows.isError && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon={<Icon.workflow />}
            title={workflows.data?.length ? "Aucune automatisation trouvée" : "Aucune automatisation"}
            description={workflows.data?.length ? "Modifiez les filtres pour retrouver vos scénarios." : "Créez votre premier flux sans code arbitraire."}
            action={workflows.data?.length && filtersActive
              ? <Button size="sm" variant="secondary" onClick={resetFilters}>Effacer les filtres</Button>
              : canChange ? <Button to="new">Créer une automatisation</Button> : undefined}
          />
        </Card>
      )}

      {filtered.length > 0 && (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-zinc-800/90 bg-(--surface-1) md:block">
            <table className="w-full table-fixed text-left">
              <thead className="border-b border-zinc-800 bg-zinc-950/35 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="w-[27%] px-4 py-3">Automatisation</th><th className="w-[15%] px-3 py-3">Déclencheur</th>
                  <th className="w-[16%] px-3 py-3">Flux</th><th className="w-[14%] px-3 py-3">Mise à jour</th>
                  <th className="w-[10%] px-3 py-3">État</th><th className="w-[18%] px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {filtered.map((workflow) => (
                  <tr key={workflow.id} className="align-middle hover:bg-(--state-hover)">
                    <td className="px-4 py-3"><Link to={workflow.id} className="font-semibold text-zinc-100 hover:text-indigo-300">{workflow.name}</Link><p className="mt-1 truncate text-xs text-zinc-500">{workflow.description || "Sans description"}</p></td>
                    <td className="px-3 py-3"><Badge tone="primary">{workflow.trigger.type}</Badge></td>
                    <td className="px-3 py-3 text-xs text-zinc-400">{workflow.conditions.length} condition(s)<br />{workflow.actions.length} action(s)</td>
                    <td className="px-3 py-3 text-xs text-zinc-400"><TimeAgo iso={workflow.updatedAt} /></td>
                    <td className="px-3 py-3"><Badge tone={workflow.circuitOpenUntil ? "danger" : workflow.enabled ? "success" : "neutral"}>{workflow.circuitOpenUntil ? "Circuit ouvert" : workflow.enabled ? "Active" : "Inactive"}</Badge></td>
                    <td className="px-4 py-3"><WorkflowActions workflow={workflow} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {filtered.map((workflow) => (
              <li key={workflow.id} className="rounded-xl border border-zinc-800 bg-(--surface-1) p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={workflow.id} className="font-semibold text-zinc-100">{workflow.name}</Link>
                  <Badge tone={workflow.enabled ? "success" : "neutral"}>{workflow.enabled ? "Active" : "Inactive"}</Badge>
                  <Badge tone="primary">{workflow.trigger.type}</Badge>
                </div>
                <p className="mt-2 break-words text-sm text-zinc-400">{workflow.description || "Sans description"}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-zinc-500">Flux</dt><dd className="mt-0.5 text-zinc-300">{workflow.conditions.length} condition(s) · {workflow.actions.length} action(s)</dd></div>
                  <div><dt className="text-zinc-500">Mise à jour</dt><dd className="mt-0.5 text-zinc-300"><TimeAgo iso={workflow.updatedAt} /></dd></div>
                </dl>
                <div className="mt-4 border-t border-zinc-800 pt-3"><WorkflowActions workflow={workflow} /></div>
              </li>
            ))}
          </ul>
        </>
      )}

      {showExecutions && (
        <Card title="Exécutions récentes" description="Journal corrélé des 100 dernières exécutions.">
          {executions.isError && <ErrorCard message="Impossible de charger le journal d’exécution." onRetry={() => void executions.refetch()} />}
          <div className="hidden md:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500"><tr><th className="pb-3">Workflow</th><th>État</th><th>Actions</th><th>Durée</th><th>Début</th><th>Corrélation</th></tr></thead>
              <tbody className="divide-y divide-zinc-800">{(executions.data ?? []).slice(0, 12).map((execution) => <tr key={execution.id}><td className="py-3 text-zinc-200">{execution.workflowName}</td><td><Badge tone={statusTone(execution.status)}>{execution.status}</Badge></td><td className="text-zinc-400">{execution.actionsSucceeded}/{execution.actionsTotal}</td><td className="text-zinc-400">{execution.durationMs == null ? "—" : `${execution.durationMs} ms`}</td><td className="text-zinc-400">{new Date(execution.startedAt).toLocaleString("fr-FR")}</td><td><code className="text-xs text-zinc-500">{execution.correlationId.slice(0, 8)}</code></td></tr>)}</tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {(executions.data ?? []).slice(0, 12).map((execution) => <li key={execution.id} className="rounded-lg border border-zinc-800 p-3 text-xs"><div className="flex justify-between gap-2"><span className="font-medium text-zinc-200">{execution.workflowName}</span><Badge tone={statusTone(execution.status)}>{execution.status}</Badge></div><p className="mt-2 text-zinc-400">{execution.actionsSucceeded}/{execution.actionsTotal} actions · {execution.durationMs == null ? "durée inconnue" : `${execution.durationMs} ms`}</p><p className="mt-1 text-zinc-500">{new Date(execution.startedAt).toLocaleString("fr-FR")} · {execution.correlationId.slice(0, 8)}</p></li>)}
          </ul>
          {executions.data?.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Aucune exécution enregistrée.</p>}
        </Card>
      )}

      <Card title="Limites d’édition" description="Valeurs du contrat actuel, sans plan inventé." pad="compact">
        <p className="text-xs leading-relaxed text-zinc-400">Chaque workflow accepte jusqu’à 20 conditions, 20 actions et 5 actions Attendre. Le quota d’automatisations actives par plan n’est pas exposé par cette réponse API : le serveur reste autoritaire.</p>
      </Card>

      <ConfirmModal
        open={toDelete !== null}
        title="Supprimer l’automatisation"
        subject={<>Supprimer <b>{toDelete?.name}</b> ?</>}
        consequence="Les exécutions planifiées en attente seront annulées. L’historique de révisions reste disponible pour l’audit."
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </div>
  );
}
