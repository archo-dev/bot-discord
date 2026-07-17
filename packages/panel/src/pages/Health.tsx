import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import type { GuildHealthResponse, HealthState, TelemetryModule } from "@bot/shared";
import { api, ApiError } from "../lib/api.js";
import { Badge, Card, EmptyState, ErrorCard, InfoCard } from "../ui/kit.js";
import { Skeleton, SkeletonList } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { formatP95, formatSuccessRate, healthStateMeta } from "../lib/health.js";

const moduleLabels: Partial<Record<TelemetryModule, string>> = {
  interactions: "Interactions Discord",
  commands: "Commandes",
  moderation: "Modération",
  tickets: "Tickets",
  roles: "Rôles",
  welcome: "Bienvenue",
  automod: "Auto-mod",
  levels: "Niveaux",
  starboard: "Starboard",
  temp_voice: "Vocaux temporaires",
  music: "Musique",
  voice_logs: "Logs vocaux",
  stats: "Statistiques",
};

function StatusBadge({ state }: { state: HealthState }) {
  const meta = healthStateMeta[state];
  return (
    <Badge tone={meta.tone}>
      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function HealthPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const health = useQuery({
    queryKey: ["health", guildId],
    queryFn: () => api<GuildHealthResponse>(`/api/guilds/${guildId}/health`),
    refetchInterval: 60_000,
  });

  if (health.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-24 rounded-xl" />
        <SkeletonList rows={5} />
      </div>
    );
  }
  if (health.isError) {
    const forbidden = health.error instanceof ApiError && health.error.status === 403;
    return (
      <ErrorCard
        message={forbidden ? "Le diagnostic détaillé est réservé aux administrateurs du serveur." : "Impossible de charger le diagnostic du serveur."}
        onRetry={forbidden ? undefined : () => void health.refetch()}
      />
    );
  }

  const data = health.data;
  return (
    <div className="space-y-4">
      <Card title="Indicateurs de service" description="Les quatre objectifs essentiels, réunis dans une seule vue.">
        <div className="grid divide-y divide-zinc-800/80 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {data.slos.map((slo) => (
            <div key={slo.id} className="px-3 py-2 first:pl-0 last:pr-0">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium text-zinc-400">{slo.label}</p>
                <StatusBadge state={slo.state} />
              </div>
              <p className="mt-1 text-xl font-bold text-zinc-100">{slo.value}</p>
              <p className="text-[11px] text-zinc-500">Objectif : {slo.target}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Gateway" description="État temps réel global, actualisé toutes les deux minutes.">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge state={data.gateway.state} />
          <span className="text-sm text-zinc-300">Ping : {data.gateway.wsPingMs == null ? "—" : `${data.gateway.wsPingMs} ms`}</span>
          <span className="text-sm text-zinc-300">Heartbeat : {data.gateway.heartbeatAgeSeconds == null ? "absent" : `il y a ${data.gateway.heartbeatAgeSeconds} s`}</span>
          {data.gateway.runtime && (
            <>
              <span className="text-sm text-zinc-300">Mémoire : {data.gateway.runtime.memoryRssMb} Mo</span>
              <span className="text-sm text-zinc-300">Files : {data.gateway.runtime.voiceLogQueueDepth + data.gateway.runtime.channelActivityQueueDepth}</span>
            </>
          )}
        </div>
        {data.gateway.runtime?.delivery?.enabled && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-800/70 pt-3 text-sm text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Livraison fiable</span>
            <span>En attente : {data.gateway.runtime.delivery.pending}</span>
            <span>Plus ancien : {data.gateway.runtime.delivery.oldestAgeSeconds} s</span>
            <span>Livrés : {data.gateway.runtime.delivery.delivered}</span>
            <span>Retries : {data.gateway.runtime.delivery.retries}</span>
            {data.gateway.runtime.delivery.dead > 0 && (
              <span className="text-amber-400">Dead-letter : {data.gateway.runtime.delivery.dead}</span>
            )}
            {data.gateway.runtime.delivery.dropped > 0 && (
              <span className="text-amber-400">Abandonnés : {data.gateway.runtime.delivery.dropped}</span>
            )}
          </div>
        )}
      </Card>

      <Card title="Modules observés · 24 h" description="Les succès sont échantillonnés et pondérés ; toutes les erreurs sont comptées.">
        {data.modules.length === 0 ? (
          <EmptyState icon={<Icon.pulse />} title="Pas encore de métriques" description="Les modules apparaîtront ici après leurs premières opérations observées." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.modules.map((module) => (
              <li key={module.module} className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-zinc-100">{moduleLabels[module.module] ?? module.module}</p>
                    <p className="mt-1 text-xs text-zinc-400">{module.estimatedEvents.toLocaleString("fr-FR")} opérations estimées · {module.errors} erreurs</p>
                  </div>
                  <StatusBadge state={module.state} />
                </div>
                <div className="mt-3 flex gap-4 text-xs text-zinc-400">
                  <span>Succès : {formatSuccessRate(module.successRate)}</span>
                  <span>p95 : {formatP95(module.approximateP95Ms)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <InfoCard icon={<Icon.shield />} title="Confidentialité du diagnostic">
        Aucune donnée de membre, contenu de message, salon, adresse IP, URL ou erreur brute n’est collectée. Les identifiants de serveur sont pseudonymisés et les agrégats sont supprimés après {data.retentionDays} jours. Référence : <code>{data.requestId}</code>.
      </InfoCard>
    </div>
  );
}
