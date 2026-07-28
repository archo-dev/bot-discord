import { useMemo, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomCommandDto, GuildModulesResponse } from "@bot/shared";
import { api } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { Badge, Button, Card, EmptyState, ErrorCard, IconButton, Input, Select, Toggle, Toolbar } from "../ui/kit.js";
import { ConfirmModal } from "../ui/overlay.js";
import { SkeletonList } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { TimeAgo } from "../ui/mod-meta.js";
import type { GuildOutletContext } from "./GuildLayout.js";

const COMMAND_LIMIT = 80;

export function CommandsPage() {
  const { guildId = "" } = useParams<{ guildId: string }>();
  const { guild } = useOutletContext<GuildOutletContext>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"all" | "enabled" | "disabled">("all");
  const [trigger, setTrigger] = useState<"all" | "slash" | "keyword">("all");
  const [toDelete, setToDelete] = useState<CustomCommandDto | null>(null);

  const commands = useQuery({
    queryKey: ["commands", guildId],
    queryFn: ({ signal }) => api<CustomCommandDto[]>(`/api/guilds/${guildId}/commands`, { signal }),
  });
  const modules = useQuery({
    queryKey: ["modules", guildId],
    queryFn: ({ signal }) => api<GuildModulesResponse>(`/api/guilds/${guildId}/modules`, { signal }),
    staleTime: 60_000,
  });
  const module = modules.data?.modules.find((candidate) => candidate.id === "custom_commands");
  const configurationAllowed = module?.actions.canConfigure ?? !modules.isError;
  const canChange = canWrite && configurationAllowed && modules.isSuccess;
  const quotaReached = (commands.data?.length ?? 0) >= COMMAND_LIMIT;

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["commands", guildId] });
  const toggle = useMutation({
    mutationFn: (command: CustomCommandDto) =>
      api(`/api/guilds/${guildId}/commands/${command.id}/state`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !command.enabled }),
      }),
    onSuccess: (_data, command) => {
      invalidate();
      toast.success(`/${command.name} ${command.enabled ? "désactivée" : "activée"}`);
    },
  });
  const remove = useMutation({
    mutationFn: (command: CustomCommandDto) =>
      api(`/api/guilds/${guildId}/commands/${command.id}`, { method: "DELETE" }),
    onSuccess: (_data, command) => {
      invalidate();
      setToDelete(null);
      toast.success(`/${command.name} supprimée`);
    },
  });

  const filtered = useMemo(() => (commands.data ?? []).filter((command) => {
    const normalized = search.toLocaleLowerCase().trim();
    const matchesSearch = !normalized || `${command.name} ${command.description}`.toLocaleLowerCase().includes(normalized);
    const matchesState = state === "all" || (state === "enabled" ? command.enabled : !command.enabled);
    return matchesSearch && matchesState && (trigger === "all" || command.triggerType === trigger);
  }), [commands.data, search, state, trigger]);
  const filtersActive = Boolean(search || state !== "all" || trigger !== "all");
  const resetFilters = () => { setSearch(""); setState("all"); setTrigger("all"); };
  const createAction = canChange && !quotaReached ? <Button to="new">Créer une commande</Button> : undefined;

  const CommandActions = ({ command }: { command: CustomCommandDto }) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canChange ? (
        <Toggle
          ariaLabel={`${command.enabled ? "Désactiver" : "Activer"} /${command.name}`}
          checked={command.enabled}
          onChange={() => { if (!toggle.isPending) toggle.mutate(command); }}
        />
      ) : (
        <Badge tone="neutral">Lecture seule</Badge>
      )}
      <Link to={String(command.id)} className="inline-flex h-8 items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[13px] font-medium text-zinc-100 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">
        {canChange ? "Modifier" : "Voir"}
      </Link>
      {canChange && (
        <IconButton label={`Supprimer /${command.name}`} danger onClick={() => setToDelete(command)}>
          <Icon.close />
        </IconButton>
      )}
    </div>
  );

  return (
    <div className="min-w-0 space-y-4">
      <Toolbar actions={createAction}>
        <div>
          <p className="text-sm font-medium text-zinc-200">Commandes personnalisées</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {commands.data ? `${commands.data.length}/${COMMAND_LIMIT} utilisées` : "Chargement du quota…"}
          </p>
        </div>
      </Toolbar>

      {modules.isError && (
        <ErrorCard
          compact
          title="Capacités du module indisponibles"
          message="Les commandes restent consultables, mais les actions d’écriture sont neutralisées tant que les capacités ne sont pas chargées."
          onRetry={() => void modules.refetch()}
          retrying={modules.isFetching}
        />
      )}
      {!canWrite && <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-sm text-amber-200">Lecture seule : les commandes restent consultables.</div>}
      {canWrite && !configurationAllowed && <div role="alert" className="rounded-xl border border-red-900/60 bg-red-950/25 px-3 py-2.5 text-sm text-red-200">Permission insuffisante : création, activation et suppression indisponibles.</div>}
      {module && !module.enabled && <div role="status" className="rounded-xl border border-zinc-700 bg-zinc-900/70 px-3 py-2.5 text-sm text-zinc-300">Module désactivé : les définitions restent conservées, mais leur exécution est arrêtée.</div>}
      {quotaReached && <div role="alert" className="rounded-xl border border-red-900/60 bg-red-950/25 px-3 py-2.5 text-sm text-red-200">Quota atteint : {commands.data?.length}/{COMMAND_LIMIT} commandes. La création est indisponible.</div>}
      {!guild?.gatewayConnected && (commands.data?.some((command) => command.gatewayRequired) ?? false) && (
        <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-sm text-amber-200">
          Gateway indisponible : les commandes slash restent disponibles, mais les déclencheurs par mot-clé ne s’exécutent pas.
        </div>
      )}

      <Card pad="compact">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_190px]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher par nom ou description…" aria-label="Rechercher une commande" />
          <Select value={state} onChange={(event) => setState(event.target.value as typeof state)} aria-label="Filtrer les commandes par état">
            <option value="all">Tous les états</option><option value="enabled">Actives</option><option value="disabled">Inactives</option>
          </Select>
          <Select value={trigger} onChange={(event) => setTrigger(event.target.value as typeof trigger)} aria-label="Filtrer les commandes par déclencheur">
            <option value="all">Tous les types</option><option value="slash">Slash</option><option value="keyword">Mot-clé</option>
          </Select>
        </div>
      </Card>

      {commands.isPending && <Card pad="compact"><SkeletonList rows={5} /></Card>}
      {commands.isError && <ErrorCard message="Impossible de charger les commandes personnalisées." onRetry={() => void commands.refetch()} />}
      {!commands.isPending && !commands.isError && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon={<Icon.command />}
            title={commands.data?.length ? "Aucune commande trouvée" : "Aucune commande personnalisée"}
            description={commands.data?.length ? "Modifiez les filtres pour retrouver vos commandes." : "Créez votre première commande sans ajouter de code arbitraire."}
            action={commands.data?.length && filtersActive
              ? <Button size="sm" variant="secondary" onClick={resetFilters}>Effacer les filtres</Button>
              : createAction}
          />
        </Card>
      )}

      {filtered.length > 0 && (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-zinc-800/90 bg-(--surface-1) shadow-(--shadow-sm) md:block">
            <table className="w-full table-fixed text-left">
              <thead className="border-b border-zinc-800 bg-zinc-950/35 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="w-[28%] px-4 py-3">Commande</th><th className="w-[14%] px-3 py-3">Type</th>
                  <th className="w-[17%] px-3 py-3">Logique</th><th className="w-[15%] px-3 py-3">Dernière donnée</th>
                  <th className="w-[10%] px-3 py-3">État</th><th className="w-[16%] px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {filtered.map((command) => (
                  <tr key={command.id} className="align-middle transition hover:bg-(--state-hover)">
                    <td className="px-4 py-3"><Link to={String(command.id)} className="font-mono text-sm font-semibold text-indigo-300 hover:text-indigo-200">/{command.name}</Link><p className="mt-1 truncate text-xs text-zinc-500">{command.description}</p></td>
                    <td className="px-3 py-3"><Badge tone={command.gatewayRequired ? "warning" : "primary"}>{command.triggerType === "slash" ? "Slash" : "Mot-clé"}</Badge></td>
                    <td className="px-3 py-3 text-xs text-zinc-400">{command.logic.conditions.length} condition(s)<br />{command.logic.actions.length} action(s)</td>
                    <td className="px-3 py-3 text-xs text-zinc-400"><TimeAgo iso={command.updatedAt ?? command.createdAt} /></td>
                    <td className="px-3 py-3"><Badge tone={command.enabled ? "success" : "neutral"}>{command.enabled ? "Active" : "Inactive"}</Badge></td>
                    <td className="px-4 py-3"><CommandActions command={command} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {filtered.map((command) => (
              <li key={command.id} className="rounded-xl border border-zinc-800 bg-(--surface-1) p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={String(command.id)} className="font-mono text-sm font-semibold text-indigo-300">/{command.name}</Link>
                  <Badge tone={command.enabled ? "success" : "neutral"}>{command.enabled ? "Active" : "Inactive"}</Badge>
                  <Badge tone={command.gatewayRequired ? "warning" : "primary"}>{command.triggerType === "slash" ? "Slash" : "Mot-clé"}</Badge>
                </div>
                <p className="mt-2 break-words text-sm text-zinc-400">{command.description}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-zinc-500">Logique</dt><dd className="mt-0.5 text-zinc-300">{command.logic.conditions.length} condition(s) · {command.logic.actions.length} action(s)</dd></div>
                  <div><dt className="text-zinc-500">Mise à jour</dt><dd className="mt-0.5 text-zinc-300"><TimeAgo iso={command.updatedAt ?? command.createdAt} /></dd></div>
                </dl>
                <div className="mt-4 border-t border-zinc-800 pt-3"><CommandActions command={command} /></div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmModal
        open={toDelete !== null}
        title="Supprimer la commande"
        subject={<>Supprimer <b className="text-zinc-100">/{toDelete?.name}</b> ?</>}
        consequence="La commande sera aussi retirée de Discord. Cette action est définitive."
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </div>
  );
}
