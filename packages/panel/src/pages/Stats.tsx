import { useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type {
  ChannelOption,
  ChannelStatsDto,
  MemberStatsDto,
  PresenceStatsDto,
  ScheduledEventDto,
} from "@bot/shared";
import { ChartCard, ChartLegend } from "../components/charts/ChartCard.js";
import {
  buildActivitySeries,
  buildPresenceChartData,
  rankChannels,
  rankScheduledEvents,
  rankedSummary,
  summarizeActivity,
  type ChartPeriod,
} from "../lib/chart-data.js";
import { api } from "../lib/api.js";
import { ActivityAreaChart, CHART_COLORS, PresenceDonut, RankedBarChart } from "../ui/charts.js";
import { SegmentedControl, Tabs } from "../ui/kit.js";

const memberPeriodOptions = [
  { value: 7 as ChartPeriod, label: "7 j" },
  { value: 30 as ChartPeriod, label: "30 j" },
  { value: 90 as ChartPeriod, label: "90 j" },
];

const channelPeriodOptions = [1, 7, 30].map((days) => ({ value: days, label: `${days} j` }));

function latestSnapshotSummary(data: MemberStatsDto | undefined): string | null {
  const latest = data?.snapshots.at(-1);
  if (!latest) return null;
  return `Dernier snapshot : ${latest.total.toLocaleString("fr-FR")} membres, dont ${latest.humans.toLocaleString("fr-FR")} humains et ${latest.bots.toLocaleString("fr-FR")} bots.`;
}

function formatVoiceSeconds(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes > 0 ? `${minutes.toLocaleString("fr-FR")} min ${seconds.toString().padStart(2, "0")} s` : `${seconds} s`;
}

export function StatsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [memberDays, setMemberDays] = useState<ChartPeriod>(7);
  const [channelDays, setChannelDays] = useState(7);
  const [channelMetric, setChannelMetric] = useState<"messages" | "voice">("messages");
  const [view, setView] = useState<"audience" | "activity">("audience");

  const members = useQuery({
    queryKey: ["stats-members", guildId, memberDays],
    queryFn: ({ signal }) => api<MemberStatsDto>(`/api/guilds/${guildId}/stats/members?days=${memberDays}`, { signal }),
    enabled: view === "audience",
  });
  const channels = useQuery({
    queryKey: ["stats-channels", guildId, channelDays],
    queryFn: ({ signal }) => api<ChannelStatsDto>(`/api/guilds/${guildId}/stats/channels?days=${channelDays}`, { signal }),
    enabled: view === "activity",
  });
  const presence = useQuery({
    queryKey: ["stats-presence", guildId],
    queryFn: ({ signal }) => api<PresenceStatsDto | null>(`/api/guilds/${guildId}/stats/presence`, { signal }),
    enabled: view === "audience",
    refetchInterval: 30_000,
  });
  const events = useQuery({
    queryKey: ["stats-events", guildId],
    queryFn: ({ signal }) => api<ScheduledEventDto[]>(`/api/guilds/${guildId}/stats/events`, { signal }),
    enabled: view === "activity",
  });
  const channelList = useQuery({
    queryKey: ["channels", guildId],
    queryFn: ({ signal }) => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`, { signal }),
    enabled: view === "activity",
    staleTime: 60_000,
  });

  const activityData = buildActivitySeries(members.data?.deltas ?? []);
  const activitySummary = summarizeActivity(activityData, memberDays);
  const arrivals = activityData.reduce((sum, point) => sum + point.arrivals, 0);
  const departures = activityData.reduce((sum, point) => sum + point.departures, 0);
  const presenceData = buildPresenceChartData(presence.data ?? {});

  const channelName = (id: string): string =>
    channelList.data?.find((channel) => channel.id === id)?.name ?? id;
  const channelSource = channelMetric === "messages" ? channels.data?.topMessages : channels.data?.topVoice;
  const rankedChannelData = rankChannels(channelSource ?? [], channelName);
  const rankedEvents = rankScheduledEvents(events.data ?? []);
  const channelUnit = channelMetric === "messages" ? "messages" : "secondes vocales";
  const channelSummary = rankedSummary(rankedChannelData, channelUnit);
  const eventsSummary = rankedSummary(rankedEvents, "intéressé(s)", events.data?.length ?? 0);

  return (
    <div className="space-y-4">
      <Tabs
        active={view}
        onChange={setView}
        tabs={[
          { id: "audience", label: "Audience" },
          { id: "activity", label: "Salons et événements" },
        ]}
      />

      {view === "audience" ? (
        <section aria-label="Audience et présence" className="grid gap-3 xl:grid-cols-12">
          <ChartCard
            title="Mouvements de membres"
            description="Arrivées et départs réellement enregistrés par le service Gateway."
            action={
              <SegmentedControl
                ariaLabel="Période du graphique d’activité"
                value={memberDays}
                onChange={setMemberDays}
                options={memberPeriodOptions}
              />
            }
            legend={
              <ChartLegend items={[
                { label: "Arrivées", color: CHART_COLORS.violet, value: arrivals.toLocaleString("fr-FR") },
                { label: "Départs", color: CHART_COLORS.green, value: departures.toLocaleString("fr-FR") },
              ]} />
            }
            loading={members.isPending}
            error={members.isError ? "Impossible de charger les mouvements de membres." : null}
            onRetry={() => void members.refetch()}
            empty={!members.isPending && !members.isError && activitySummary.empty}
            emptyTitle="Aucun mouvement disponible"
            emptyDescription={`Aucune arrivée ou aucun départ n’est disponible sur la période de ${memberDays} jours.`}
            summary={activitySummary.text}
            footer={latestSnapshotSummary(members.data)}
            minHeight={390}
            className="xl:col-span-8"
          >
            <ActivityAreaChart data={activityData} summary={activitySummary.text} height={285} />
          </ChartCard>

          <ChartCard
            title="Présence des membres"
            description="Répartition actuelle déclarée par Discord."
            loading={presence.isPending}
            error={presence.isError ? "Impossible de charger la présence des membres." : null}
            onRetry={() => void presence.refetch()}
            empty={!presence.isPending && !presence.isError && presenceData.total === 0}
            emptyTitle="Présence non disponible"
            emptyDescription="La Gateway et le Presence Intent sont nécessaires pour afficher cette répartition."
            summary={presenceData.summary}
            minHeight={390}
            className="xl:col-span-4"
          >
            <PresenceDonut
              slices={presenceData.slices}
              total={presenceData.total}
              summary={presenceData.summary}
              height={250}
            />
          </ChartCard>
        </section>
      ) : (
        <section aria-label="Classements d’activité" className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Salons les plus actifs"
            description={
              channelMetric === "messages"
                ? "Classement des dix salons par messages collectés sur la période."
                : "Classement des dix salons par durée vocale collectée sur la période."
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  ariaLabel="Métrique du classement des salons"
                  value={channelMetric}
                  onChange={setChannelMetric}
                  options={[
                    { value: "messages", label: "Messages" },
                    { value: "voice", label: "Vocal" },
                  ]}
                />
                <SegmentedControl
                  ariaLabel="Période du classement des salons"
                  value={channelDays}
                  onChange={setChannelDays}
                  options={channelPeriodOptions}
                />
              </div>
            }
            loading={channels.isPending || channelList.isPending}
            error={channels.isError || channelList.isError ? "Impossible de charger le classement des salons." : null}
            onRetry={() => {
              void channels.refetch();
              void channelList.refetch();
            }}
            empty={!channels.isPending && !channels.isError && rankedChannelData.length === 0}
            emptyTitle="Aucune activité de salon"
            emptyDescription="Aucune valeur n’est disponible pour cette métrique sur la période sélectionnée."
            summary={channelSummary}
            minHeight={430}
          >
            <RankedBarChart
              data={rankedChannelData}
              unit={channelMetric === "messages" ? "msg" : "vocal"}
              formatValue={channelMetric === "messages" ? undefined : formatVoiceSeconds}
            />
          </ChartCard>

          <ChartCard
            title="Intérêt pour les événements Discord"
            description="Classement des événements programmés disposant d’un nombre d’intéressés."
            loading={events.isPending}
            error={events.isError ? "Impossible de charger les événements programmés." : null}
            onRetry={() => void events.refetch()}
            empty={!events.isPending && !events.isError && rankedEvents.length === 0}
            emptyTitle="Classement indisponible"
            emptyDescription={
              (events.data?.length ?? 0) === 0
                ? "Aucun événement Discord n’est actuellement programmé."
                : "Les événements ne fournissent pas de nombre d’intéressés comparable."
            }
            summary={eventsSummary}
            minHeight={430}
          >
            <RankedBarChart data={rankedEvents} unit="intéressé(s)" />
          </ChartCard>
        </section>
      )}
    </div>
  );
}
