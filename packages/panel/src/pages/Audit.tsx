import { useState } from "react";
import { useParams } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { PANEL_CAPABILITIES, type AdminAuditEntryDto, type AdminAuditPage, type PanelCapability } from "@bot/shared";
import { api, ApiError } from "../lib/api.js";
import { Badge, Button, Card, EmptyState, ErrorCard, ResponsiveData, TableWrap, Toolbar } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { SkeletonList } from "../ui/skeleton.js";
import { TimeAgo } from "../ui/mod-meta.js";

const CAPABILITY_LABELS: Record<PanelCapability, string> = {
  guild_config_write: "Configuration",
  guild_identity_write: "Identité du bot",
  panel_access_manage: "Accès panel",
  roles_write: "Rôles",
  roles_publish: "Publication de rôles",
  moderation_write: "Modération",
  commands_write: "Commandes",
  music_control: "Musique",
  tickets_write: "Tickets",
};

function actorLabel(entry: AdminAuditEntryDto): string {
  return entry.actorAccess === "manage_guild" ? "Gestionnaire Discord" : "Administrateur panel";
}

function Target({ entry }: { entry: AdminAuditEntryDto }) {
  if (!entry.targetType || !entry.targetId) return <span className="text-zinc-600">—</span>;
  const labels = { command: "Commande", warning: "Avertissement", button_role: "Bouton-rôle" } as const;
  return <span className="text-zinc-300">{labels[entry.targetType]} #{entry.targetId}</span>;
}

export function AuditPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [capability, setCapability] = useState("");
  const [outcome, setOutcome] = useState("");
  const logs = useInfiniteQuery({
    queryKey: ["admin-audit", guildId, { capability, outcome }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "25" });
      if (capability) params.set("capability", capability);
      if (outcome) params.set("outcome", outcome);
      if (pageParam) params.set("cursor", pageParam);
      return api<AdminAuditPage>(`/api/guilds/${guildId}/audit?${params}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = logs.data?.pages.flatMap((page) => page.items) ?? [];
  const hasFilters = Boolean(capability || outcome);
  const reset = () => { setCapability(""); setOutcome(""); };

  if (logs.isError && logs.error instanceof ApiError && logs.error.status === 403) {
    return <ErrorCard message="L’historique de sécurité est réservé aux administrateurs du serveur." />;
  }

  return (
    <div className="max-w-6xl space-y-5">
      <Card title="Historique administratif" description="Actions de configuration et de gestion effectuées depuis le panel. Conservation limitée à 90 jours.">
        <Toolbar className="mb-4">
          <select value={capability} onChange={(event) => setCapability(event.target.value)} className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100" aria-label="Filtrer par domaine">
            <option value="">Tous les domaines</option>
            {PANEL_CAPABILITIES.map((value) => <option key={value} value={value}>{CAPABILITY_LABELS[value]}</option>)}
          </select>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value)} className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100" aria-label="Filtrer par résultat">
            <option value="">Tous les résultats</option>
            <option value="success">Succès</option>
            <option value="error">Échec</option>
          </select>
          {hasFilters && <Button variant="ghost" size="sm" onClick={reset}>Réinitialiser</Button>}
        </Toolbar>

        {logs.isPending ? <SkeletonList rows={6} /> : logs.isError ? (
          <ErrorCard message="Impossible de charger l’historique administratif." onRetry={() => void logs.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Icon.shield />} title={hasFilters ? "Aucun résultat pour ces filtres" : "Aucune action administrative enregistrée"} description={hasFilters ? undefined : "Les prochaines modifications du panel apparaîtront ici."} action={hasFilters ? <Button variant="secondary" size="sm" onClick={reset}>Effacer les filtres</Button> : undefined} />
        ) : (
          <>
            <ResponsiveData
              table={<TableWrap><thead><tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="py-2 pr-4">Action</th><th className="py-2 pr-4">Auteur</th><th className="py-2 pr-4">Cible</th><th className="py-2 pr-4">Résultat</th><th className="py-2 text-right">Date</th></tr></thead><tbody className="divide-y divide-white/5">{items.map((entry) => <tr key={entry.id}><td className="py-3 pr-4"><div className="font-medium text-zinc-100">{CAPABILITY_LABELS[entry.capability]}</div><div className="mt-0.5 text-xs text-zinc-500">{entry.method} · réf. {entry.requestId}</div></td><td className="py-3 pr-4"><div className="text-zinc-200">{actorLabel(entry)}</div><code className="text-xs text-zinc-500">{entry.actorId}</code></td><td className="py-3 pr-4"><Target entry={entry} /></td><td className="py-3 pr-4"><Badge tone={entry.outcome === "success" ? "success" : "danger"}>{entry.outcome === "success" ? "Succès" : `Échec ${entry.status}`}</Badge></td><td className="whitespace-nowrap py-3 text-right text-zinc-500"><TimeAgo iso={entry.createdAt} /></td></tr>)}</tbody></TableWrap>}
              cards={<ul className="space-y-2">{items.map((entry) => <li key={entry.id} className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-zinc-100">{CAPABILITY_LABELS[entry.capability]}</p><p className="mt-1 text-xs text-zinc-500">{actorLabel(entry)} · {entry.actorId}</p></div><Badge tone={entry.outcome === "success" ? "success" : "danger"}>{entry.outcome === "success" ? "Succès" : `Échec ${entry.status}`}</Badge></div><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-zinc-500"><span>{entry.method} · réf. {entry.requestId}</span><TimeAgo iso={entry.createdAt} /></div><div className="mt-2 text-xs"><Target entry={entry} /></div></li>)}</ul>}
            />
            {logs.hasNextPage && <div className="mt-4 flex justify-center"><Button variant="secondary" size="sm" loading={logs.isFetchingNextPage} onClick={() => void logs.fetchNextPage()}>Charger plus</Button></div>}
          </>
        )}
      </Card>
    </div>
  );
}
