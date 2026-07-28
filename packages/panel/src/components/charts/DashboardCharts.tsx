import { Link } from "react-router";
import type { MemberStatsDto, PresenceStatsDto, ScheduledEventDto } from "@bot/shared";
import type { DashboardResource } from "../dashboard/DashboardGrid.js";
import {
  buildActivitySeries,
  buildPresenceChartData,
  rankScheduledEvents,
  rankedSummary,
  resolveMemberPopulation,
  summarizeActivity,
  type ChartPeriod,
} from "../../lib/chart-data.js";
import { ActivityAreaChart, CHART_COLORS, PresenceDonut, RankedBarChart } from "../../ui/charts.js";
import { SegmentedControl } from "../../ui/kit.js";
import { ChartCard, ChartLegend } from "./ChartCard.js";

const periodOptions = [
  { value: 7 as ChartPeriod, label: "7 j" },
  { value: 30 as ChartPeriod, label: "30 j" },
  { value: 90 as ChartPeriod, label: "90 j" },
];

export function DashboardCharts({
  guildId,
  memberTotal,
  gatewayConnected,
  period,
  onPeriodChange,
  members,
  events,
  presence,
}: {
  guildId: string;
  memberTotal: number | null;
  gatewayConnected: boolean;
  period: ChartPeriod;
  onPeriodChange: (period: ChartPeriod) => void;
  members: DashboardResource<MemberStatsDto>;
  events: DashboardResource<ScheduledEventDto[]>;
  presence: DashboardResource<PresenceStatsDto | null>;
}) {
  const activityData = buildActivitySeries(members.data?.deltas ?? []);
  const activitySummary = summarizeActivity(activityData, period);
  const arrivals = activityData.reduce((sum, point) => sum + point.arrivals, 0);
  const departures = activityData.reduce((sum, point) => sum + point.departures, 0);
  const rankedEvents = rankScheduledEvents(events.data ?? []);
  const eventSummary = rankedSummary(rankedEvents, "intéressé(s)", events.data?.length ?? 0);
  const population = resolveMemberPopulation(memberTotal, members.data?.snapshots ?? []);
  const presenceData = buildPresenceChartData(presence.data ?? {}, population);

  return (
    <section aria-label="Visualisations du dashboard" className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-12">
      <ChartCard
        title="Mouvements de membres"
        description="Arrivées et départs réellement enregistrés par jour."
        action={
          <SegmentedControl
            ariaLabel="Période du graphique d’activité"
            value={period}
            onChange={onPeriodChange}
            options={periodOptions}
          />
        }
        legend={
          <ChartLegend items={[
            { label: "Arrivées", color: CHART_COLORS.violet, value: arrivals.toLocaleString("fr-FR") },
            { label: "Départs", color: CHART_COLORS.green, value: departures.toLocaleString("fr-FR") },
          ]} />
        }
        loading={members.pending}
        error={members.error ? "Impossible de charger les mouvements de membres." : null}
        onRetry={members.retry}
        empty={!members.pending && !members.error && activitySummary.empty}
        emptyTitle={gatewayConnected ? "Aucun mouvement disponible" : "Gateway indisponible"}
        emptyDescription={
          gatewayConnected
            ? `Aucune arrivée ou aucun départ n’est disponible sur la période de ${period} jours.`
            : "La collecte des mouvements de membres dépend du service Gateway."
        }
        summary={activitySummary.text}
        minHeight={300}
        className="h-full xl:col-span-5"
        footer={<Link to={`/guilds/${guildId}/stats`} className="text-xs font-medium text-indigo-400 hover:underline">Ouvrir Observabilité</Link>}
      >
        <ActivityAreaChart data={activityData} summary={activitySummary.text} height={210} />
      </ChartCard>

      <ChartCard
        title="Intérêt pour les événements Discord"
        description="Classement des événements programmés disposant d’un nombre d’intéressés."
        loading={events.pending}
        error={events.error ? "Impossible de charger les événements programmés." : null}
        onRetry={events.retry}
        empty={!events.pending && !events.error && rankedEvents.length === 0}
        emptyTitle="Classement indisponible"
        emptyDescription={
          (events.data?.length ?? 0) === 0
            ? "Aucun événement Discord n’est actuellement programmé."
            : "Les événements programmés ne fournissent pas de nombre d’intéressés comparable."
        }
        summary={eventSummary}
        minHeight={300}
        className="h-full xl:col-span-3"
        footer={<Link to={`/guilds/${guildId}/stats`} className="text-xs font-medium text-indigo-400 hover:underline">Voir les statistiques</Link>}
      >
        <RankedBarChart data={rankedEvents.slice(0, 5)} unit="intéressé(s)" />
      </ChartCard>

      <ChartCard
        title="Répartition des membres"
        description="Présence déclarée au moment de l’actualisation."
        loading={presence.pending}
        error={presence.error ? "Impossible de charger la présence des membres." : null}
        onRetry={presence.retry}
        empty={!presence.pending && !presence.error && presenceData.total === 0}
        emptyTitle="Présence non disponible"
        emptyDescription={
          gatewayConnected
            ? "Le Presence Intent n’est pas actif ou aucune présence n’est disponible."
            : "La répartition nécessite une Gateway connectée et le Presence Intent."
        }
        summary={presenceData.summary}
        minHeight={300}
        className="h-full md:col-span-2 xl:col-span-4"
      >
        <PresenceDonut
          slices={presenceData.slices}
          total={presenceData.total}
          summary={presenceData.summary}
          height={205}
        />
      </ChartCard>
    </section>
  );
}
