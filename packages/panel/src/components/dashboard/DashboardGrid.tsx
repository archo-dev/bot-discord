import { lazy, Suspense } from "react";
import { Link } from "react-router";
import type {
  GuildHealthResponse,
  MemberStatsDto,
  ModActionDto,
  Paginated,
  PresenceStatsDto,
  ScheduledEventDto,
} from "@bot/shared";
import type { ApiError } from "../../lib/api.js";
import { healthStateMeta } from "../../lib/health.js";
import type { NavigationAvailability } from "../../navigation/registry.js";
import { buildQuickActions, type DashboardKpi } from "../../pages/dashboard-view-model.js";
import type { ChartPeriod } from "../../lib/chart-data.js";
import { UserCell } from "../../ui/cells.js";
import { Icon } from "../../ui/icons.js";
import { actionMeta, ModActionIcon, TimeAgo } from "../../ui/mod-meta.js";
import { Badge, Card } from "../../ui/kit.js";
import { Skeleton, SkeletonList } from "../../ui/skeleton.js";
import { ChartCard } from "../charts/ChartCard.js";

const DashboardCharts = lazy(() =>
  import("../charts/DashboardCharts.js").then((module) => ({ default: module.DashboardCharts })),
);

export interface DashboardResource<T> {
  readonly data: T | undefined;
  readonly pending: boolean;
  readonly error: ApiError | Error | null;
  readonly retry: () => void;
}

const kpiTone = {
  violet: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/10",
  green: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/10",
  blue: "bg-blue-500/15 text-blue-300 ring-blue-400/10",
  amber: "bg-amber-500/15 text-amber-300 ring-amber-400/10",
} as const;

export function KpiCard({ metric, loading = false }: { metric: DashboardKpi; loading?: boolean }) {
  const MetricIcon = Icon[metric.icon];
  return (
    <article
      data-dashboard-kpi={metric.id}
      className="min-h-[132px] rounded-xl border border-zinc-800/90 bg-[linear-gradient(150deg,rgba(29,26,40,0.98),rgba(22,20,31,0.98))] p-4 shadow-(--shadow-card)"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-medium text-zinc-400">{metric.label}</h3>
          {loading ? (
            <Skeleton className="mt-3 h-8 w-20" />
          ) : (
            <p className="mt-2 text-[28px] font-bold leading-none tracking-tight text-zinc-100 tabular-nums">
              {metric.value}
            </p>
          )}
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-4 ${kpiTone[metric.tone]}`} aria-hidden>
          <MetricIcon />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-3 w-4/5" />
      ) : metric.unavailable ? (
        <UnavailableMetric explanation={metric.hint} compact />
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-zinc-500">{metric.hint}</p>
      )}
    </article>
  );
}

export function UnavailableMetric({
  explanation,
  compact = false,
}: {
  explanation: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-3" : "rounded-lg border border-dashed border-zinc-700/80 bg-zinc-950/25 p-3"}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" aria-hidden />
        Non disponible
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{explanation}</p>
    </div>
  );
}

function InlineError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3">
      <p className="text-sm font-medium text-red-200">{message}</p>
      <button
        type="button"
        onClick={retry}
        className="mt-2 text-xs font-semibold text-red-300 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
      >
        Réessayer
      </button>
    </div>
  );
}

function BlockSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HealthSummary({
  resource,
  accessDenied,
}: {
  resource: DashboardResource<GuildHealthResponse>;
  accessDenied: boolean;
}) {
  if (accessDenied) {
    return (
      <Card title="Santé du serveur" description="Diagnostic réservé aux comptes autorisés." className="h-full min-h-[286px]">
        <div className="flex min-h-44 flex-col items-center justify-center text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-zinc-500" aria-hidden><Icon.key /></span>
          <p className="mt-3 text-sm font-semibold text-zinc-300">Accès administrateur requis</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
            Les diagnostics techniques détaillés ne sont pas exposés aux comptes en lecture seule.
          </p>
        </div>
      </Card>
    );
  }
  return (
    <Card
      title="Santé du serveur"
      description="Indicateurs existants du diagnostic."
      className="h-full min-h-[286px]"
      action={<Link to="health" className="text-xs font-medium text-indigo-400 hover:underline">Détails</Link>}
    >
      {resource.pending ? (
        <BlockSkeleton rows={4} />
      ) : resource.error ? (
        <InlineError message="Impossible de charger la santé du serveur." retry={resource.retry} />
      ) : resource.data ? (
        <div className="space-y-2">
          <div className="mb-3 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2">
            <span className="text-xs text-zinc-400">Gateway</span>
            <HealthBadge state={resource.data.gateway.state} />
          </div>
          {resource.data.slos.slice(0, 4).map((slo) => (
            <div key={slo.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-zinc-400">{slo.label}</span>
              <HealthBadge state={slo.state} />
            </div>
          ))}
        </div>
      ) : (
        <UnavailableMetric explanation="Le diagnostic n’a retourné aucune donnée exploitable." />
      )}
    </Card>
  );
}

function HealthBadge({ state }: { state: GuildHealthResponse["gateway"]["state"] }) {
  const meta = healthStateMeta[state];
  return (
    <Badge tone={meta.tone}>
      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function QuickActions({
  guildId,
  availability,
}: {
  guildId: string;
  availability: NavigationAvailability;
}) {
  const actions = buildQuickActions(availability);
  return (
    <Card
      title="Actions rapides"
      description={availability.canWrite ? "Accès direct aux réglages courants." : "Accès direct en consultation."}
      className="h-full min-h-[286px]"
    >
      <ul className="grid grid-cols-2 gap-2">
        {actions.map((action) => {
          const ActionIcon = Icon[action.icon];
          const path = action.path ? `/guilds/${guildId}/${action.path}` : `/guilds/${guildId}`;
          return (
            <li key={action.id}>
              <Link
                to={path}
                className="flex min-h-16 flex-col justify-between rounded-lg border border-zinc-800 bg-zinc-950/30 p-2.5 text-xs font-medium text-zinc-300 transition hover:border-indigo-500/50 hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-indigo-300 [&_svg]:h-4 [&_svg]:w-4" aria-hidden><ActionIcon /></span>
                  {!action.gatewayAvailable && (
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" aria-hidden />
                  )}
                </span>
                <span className="mt-2">
                  <span className="block">{action.label}</span>
                  {!action.gatewayAvailable && (
                    <span className="mt-0.5 block text-[9px] font-normal text-zinc-500">Gateway requise</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function RecentModeration({
  guildId,
  resource,
}: {
  guildId: string;
  resource: DashboardResource<Paginated<ModActionDto>>;
}) {
  const recent = resource.data?.items.slice(0, 4) ?? [];
  return (
    <Card
      title="Modération récente"
      description="Actions réellement enregistrées dans l’historique."
      className="h-full min-h-[286px]"
      action={<Link to={`/guilds/${guildId}/sanctions`} className="text-xs font-medium text-indigo-400 hover:underline">Voir tout</Link>}
    >
      {resource.pending ? (
        <SkeletonList rows={4} />
      ) : resource.error ? (
        <InlineError message="Impossible de charger la modération récente." retry={resource.retry} />
      ) : recent.length === 0 ? (
        <UnavailableMetric explanation="Aucune action de modération enregistrée sur la page la plus récente." />
      ) : (
        <ul className="divide-y divide-white/5">
          {recent.map((action) => (
            <li key={action.id} className="flex items-center gap-2.5 py-2">
              <ModActionIcon action={action.action} size={30} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-zinc-200">{actionMeta(action.action).label}</p>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {action.targetId ? <UserCell userId={action.targetId} /> : "Cible non renseignée"}
                </div>
              </div>
              <TimeAgo iso={action.createdAt} className="shrink-0 text-[10px] text-zinc-500" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function RecentActivity() {
  return (
    <Card
      title="Activité récente"
      description="Aucun flux métier unifié n’est exposé."
      className="h-full min-h-[286px]"
    >
      <div className="flex min-h-44 flex-col items-center justify-center text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-zinc-500" aria-hidden><Icon.scroll /></span>
        <p className="mt-3 text-sm font-semibold text-zinc-300">Non disponible pour le moment</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
          Les événements programmés ne sont pas présentés comme une activité métier récente.
        </p>
      </div>
    </Card>
  );
}

function DashboardChartsFallback() {
  return (
    <section aria-label="Chargement des visualisations" className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-12">
      <ChartCard
        title="Mouvements de membres"
        description="Arrivées et départs réellement enregistrés par jour."
        action={<Skeleton className="h-7 w-28 rounded-lg" />}
        loading
        minHeight={300}
        className="h-full xl:col-span-5"
      >
        <span />
      </ChartCard>
      <ChartCard
        title="Intérêt pour les événements Discord"
        description="Classement des événements programmés disposant d’un nombre d’intéressés."
        loading
        minHeight={300}
        className="h-full xl:col-span-3"
      >
        <span />
      </ChartCard>
      <ChartCard
        title="Répartition des membres"
        description="Présence déclarée au moment de l’actualisation."
        loading
        minHeight={300}
        className="h-full md:col-span-2 xl:col-span-4"
      >
        <span />
      </ChartCard>
    </section>
  );
}

export function DashboardGrid({
  guildId,
  memberTotal,
  gatewayConnected,
  availability,
  activityPeriod,
  onActivityPeriodChange,
  kpis,
  members,
  presence,
  events,
  health,
  healthAccessDenied,
  moderation,
}: {
  guildId: string;
  memberTotal: number | null;
  gatewayConnected: boolean;
  availability: NavigationAvailability;
  activityPeriod: ChartPeriod;
  onActivityPeriodChange: (period: ChartPeriod) => void;
  kpis: DashboardKpi[];
  members: DashboardResource<MemberStatsDto>;
  presence: DashboardResource<PresenceStatsDto | null>;
  events: DashboardResource<ScheduledEventDto[]>;
  health: DashboardResource<GuildHealthResponse>;
  healthAccessDenied: boolean;
  moderation: DashboardResource<Paginated<ModActionDto>>;
}) {
  return (
    <div className="space-y-4">
      <section aria-labelledby="dashboard-kpis-title">
        <h2 id="dashboard-kpis-title" className="sr-only">Indicateurs clés</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((metric) => (
            <KpiCard key={metric.id} metric={metric} loading={metric.id === "online" && presence.pending} />
          ))}
        </div>
      </section>

      <Suspense fallback={<DashboardChartsFallback />}>
        <DashboardCharts
          guildId={guildId}
          memberTotal={memberTotal}
          gatewayConnected={gatewayConnected}
          period={activityPeriod}
          onPeriodChange={onActivityPeriodChange}
          members={members}
          events={events}
          presence={presence}
        />
      </Suspense>

      <section aria-label="Pilotage et raccourcis" className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-4">
        <HealthSummary resource={health} accessDenied={healthAccessDenied} />
        <QuickActions guildId={guildId} availability={availability} />
        <RecentModeration guildId={guildId} resource={moderation} />
        <RecentActivity />
      </section>
    </div>
  );
}
