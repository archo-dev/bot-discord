import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GuildModuleDto, GuildModulesResponse, ModuleCategory } from "@bot/shared";
import { api, ApiError } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { MODULE_STATE_META, moduleReasonLabel } from "../lib/modules.js";
import { Badge, Button, Card, EmptyState, ErrorCard, Input, Select, Toolbar } from "../ui/kit.js";
import { Icon, type IconName } from "../ui/icons.js";
import { ConfirmModal } from "../ui/overlay.js";
import { Skeleton } from "../ui/skeleton.js";
import { toast } from "../ui/toast.js";

const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  server: "Serveur", engagement: "Engagement", moderation: "Modération", tools: "Outils", operations: "Opérations",
};

function ModuleIcon({ name }: { name: string }) {
  const component = Icon[name as IconName] ?? Icon.bolt;
  return component();
}

function diagnostic(module: GuildModuleDto): string {
  const reasons = module.enabled ? module.reasons : module.activationReasons;
  return moduleReasonLabel(reasons[0] ?? { code: module.enabled ? "module_enabled" : "module_disabled" });
}

function mutationMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Impossible de modifier ce module.";
  if (error.code === "module_prerequisite_failed") return "Les prérequis de ce module ne sont pas remplis.";
  if (error.code === "module_prerequisite_unknown") return "Les prérequis Discord ne peuvent pas être vérifiés actuellement.";
  if (error.code === "module_not_toggleable") return "Ce module est requis et ne peut pas être désactivé.";
  return "Impossible de modifier ce module.";
}

export function ModulesPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | ModuleCategory>("all");
  const [disableTarget, setDisableTarget] = useState<GuildModuleDto | null>(null);

  const modules = useQuery({
    queryKey: ["modules", guildId],
    queryFn: () => api<GuildModulesResponse>(`/api/guilds/${guildId}/modules`),
    refetchInterval: 60_000,
  });
  const toggle = useMutation({
    mutationFn: ({ module, enabled }: { module: GuildModuleDto; enabled: boolean }) => api<GuildModuleDto>(
      `/api/guilds/${guildId}/modules/${module.id}`,
      { method: "PATCH", body: JSON.stringify({ enabled }) },
    ),
    meta: { silentError: true },
    onSuccess: (updated) => {
      queryClient.setQueryData<GuildModulesResponse>(["modules", guildId], (current) => current ? {
        ...current,
        generatedAt: new Date().toISOString(),
        modules: current.modules.map((module) => module.id === updated.id ? updated : module),
      } : current);
      setDisableTarget(null);
      toast.success(updated.enabled ? `${updated.publicName} activé.` : `${updated.publicName} désactivé.`);
    },
    onError: (error) => toast.error(mutationMessage(error)),
  });

  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("fr-FR");
    return (modules.data?.modules ?? []).filter((module) =>
      (category === "all" || module.category === category)
      && (!normalized || `${module.publicName} ${module.description}`.toLocaleLowerCase("fr-FR").includes(normalized)),
    );
  }, [category, modules.data, search]);

  if (modules.isPending) return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-16 rounded-xl" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }, (_, index) => <Skeleton key={index} className="h-64 rounded-xl" />)}
      </div>
    </div>
  );
  if (modules.isError) return <ErrorCard message="Impossible de charger les modules du serveur." onRetry={() => void modules.refetch()} />;

  return (
    <div className="space-y-5">
      <Toolbar>
        <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un module…" aria-label="Rechercher un module" className="sm:max-w-sm" />
        <Select value={category} onChange={(event) => setCategory(event.target.value as "all" | ModuleCategory)} aria-label="Filtrer par catégorie" className="sm:max-w-52">
          <option value="all">Toutes les catégories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </Toolbar>

      {!modules.data.gateway.online && (
        <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          La Gateway est hors ligne. Les modules temps réel restent configurés, mais leur activation est bloquée jusqu’au retour du service.
        </div>
      )}

      {filtered.length === 0 ? (
        <Card><EmptyState icon={<Icon.sliders />} title="Aucun module trouvé" description="Modifiez la recherche ou le filtre de catégorie." /></Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((module) => {
            const meta = MODULE_STATE_META[module.state];
            const pending = toggle.isPending && toggle.variables?.module.id === module.id;
            return (
              <li key={module.id}>
                <Card className="flex h-full flex-col" pad="compact">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden><ModuleIcon name={module.panel.icon} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-zinc-100">{module.publicName}</h2><Badge tone={meta.tone}>{meta.label}</Badge></div>
                      <p className="mt-1 text-xs text-zinc-500">{CATEGORY_LABELS[module.category]}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-[13px] leading-relaxed text-zinc-400">{module.description}</p>
                  <p className={`mt-3 text-xs leading-relaxed ${module.state === "enabled" ? "text-green-400" : module.state === "disabled" ? "text-zinc-500" : "text-amber-300"}`}>{diagnostic(module)}</p>
                  {module.dependencies.length > 0 && <p className="mt-2 text-xs text-zinc-500">Dépendances : {module.dependencies.join(", ")}</p>}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                    {module.panel.configurePath && <Link to={`../${module.panel.configurePath}`} className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-700 bg-(--surface-2) px-3 text-[13px] font-semibold text-zinc-100 transition hover:border-zinc-600 hover:bg-(--surface-3) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">Configurer</Link>}
                    {module.toggleable && module.enabled && <Button size="sm" variant="ghost" disabled={!canWrite || !module.actions.canDisable || pending} loading={pending} onClick={() => setDisableTarget(module)}>Désactiver</Button>}
                    {module.toggleable && !module.enabled && <Button size="sm" disabled={!canWrite || !module.actions.canEnable || pending} loading={pending} title={!module.actions.canEnable ? diagnostic(module) : undefined} onClick={() => toggle.mutate({ module, enabled: true })}>Activer</Button>}
                    {!module.toggleable && <span className="text-xs text-zinc-500">Module système requis</span>}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        open={disableTarget !== null}
        title="Désactiver ce module ?"
        subject={disableTarget ? <><strong className="text-zinc-100">{disableTarget.publicName}</strong> cessera de s’exécuter sur ce serveur.</> : null}
        consequence={disableTarget ? `La configuration et les données existantes sont conservées. Conséquence : ${disableTarget.disableConsequence}.` : undefined}
        confirmLabel="Désactiver"
        loading={toggle.isPending}
        onCancel={() => setDisableTarget(null)}
        onConfirm={() => disableTarget && toggle.mutate({ module: disableTarget, enabled: false })}
      />
    </div>
  );
}
