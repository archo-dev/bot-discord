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
import { api } from "../lib/api.js";
import { Card, EmptyState, ErrorCard, InfoCard, SegmentedControl, Tabs } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { Skeleton } from "../ui/skeleton.js";
import { ChannelBarChart, JoinLeaveChart, MembersChart, PresenceDonut, type NamedStat } from "../ui/charts.js";

/** Options de plage en jours pour un SegmentedControl. */
const dayOptions = (...days: number[]) => days.map((d) => ({ value: d, label: `${d} j` }));

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div style={{ height }}>
      <Skeleton className="h-full w-full rounded-lg" />
    </div>
  );
}

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function EventsList({ events, channelName }: { events: ScheduledEventDto[]; channelName: (id: string | null) => string | null }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Icon.trophy />}
        title="Aucun événement à venir"
        description="Les événements programmés du serveur (Discord → Événements) apparaîtront ici, triés par date."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {events.map((e) => {
        const where = e.location ?? channelName(e.channelId);
        return (
          <li key={e.id} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">{e.name}</span>
              {e.interestedCount != null && (
                <span className="shrink-0 text-xs text-zinc-500">{e.interestedCount} intéressé(s)</span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-400">
              <span className="text-indigo-300">{formatEventDate(e.scheduledStartTime)}</span>
              {where && <span className="truncate">· {where}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function StatsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [memberDays, setMemberDays] = useState(7);
  const [channelDays, setChannelDays] = useState(7);
  const [channelMetric, setChannelMetric] = useState<"messages" | "voice">("messages");
  const [view, setView] = useState<"audience" | "activity">("audience");

  const members = useQuery({
    queryKey: ["stats-members", guildId, memberDays],
    queryFn: () => api<MemberStatsDto>(`/api/guilds/${guildId}/stats/members?days=${memberDays}`),
    enabled: view === "audience",
  });
  const channels = useQuery({
    queryKey: ["stats-channels", guildId, channelDays],
    queryFn: () => api<ChannelStatsDto>(`/api/guilds/${guildId}/stats/channels?days=${channelDays}`),
    enabled: view === "activity",
  });
  const presence = useQuery({
    queryKey: ["stats-presence", guildId],
    queryFn: () => api<PresenceStatsDto | null>(`/api/guilds/${guildId}/stats/presence`),
    enabled: view === "audience",
    refetchInterval: 30_000,
  });
  const events = useQuery({
    queryKey: ["stats-events", guildId],
    queryFn: () => api<ScheduledEventDto[]>(`/api/guilds/${guildId}/stats/events`),
    enabled: view === "activity",
  });
  const channelList = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
    enabled: view === "activity",
    staleTime: 60_000,
  });

  const channelName = (id: string | null): string | null =>
    id ? (channelList.data?.find((c) => c.id === id)?.name ?? id) : null;

  const rawChannelData = channelMetric === "messages" ? channels.data?.topMessages : channels.data?.topVoice;
  const channelData: NamedStat[] = (rawChannelData ?? []).map((c) => ({
    name: `#${channelName(c.channelId) ?? c.channelId}`,
    value: c.value,
  }));

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
        <>
      {/* Membres — grande courbe humains/bots */}
      <Card
        title="Membres"
        description="Évolution du nombre de membres (snapshots horaires du service Gateway)."
        action={<SegmentedControl ariaLabel="Période — membres" value={memberDays} onChange={setMemberDays} options={dayOptions(7, 30, 90)} />}
      >
        {members.isPending ? (
          <ChartSkeleton height={260} />
        ) : members.isError ? (
          <ErrorCard message="Impossible de charger l'évolution des membres." onRetry={() => void members.refetch()} />
        ) : (
          <MembersChart data={members.data?.snapshots ?? []} hourly={memberDays === 7} />
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Arrivées & départs" description="Agrégées par jour depuis les événements du serveur.">
          {members.isPending ? <ChartSkeleton height={200} /> : members.isError ? <ErrorCard message="Impossible de charger les arrivées et départs." onRetry={() => void members.refetch()} /> : <JoinLeaveChart data={members.data?.deltas ?? []} />}
        </Card>

        <Card title="Présence" description="Répartition des statuts en temps réel.">
          {presence.isPending ? (
            <ChartSkeleton height={200} />
          ) : presence.isError ? (
            <ErrorCard message="Impossible de charger la présence." onRetry={() => void presence.refetch()} />
          ) : presence.data ? (
            <PresenceDonut data={presence.data} />
          ) : (
            <InfoCard icon={<Icon.bolt />} title="Activer la présence">
              La répartition en ligne / absent / ne pas déranger nécessite le <b>Presence Intent</b> (intent privilégié).
              Active-le dans le portail développeur Discord (<i>Bot → Presence Intent</i>) puis redémarre le service
              Gateway. La page reste fonctionnelle sans lui.
            </InfoCard>
          )}
        </Card>
      </div>
        </>
      ) : (
      <div className="grid gap-3 lg:grid-cols-2">
        <Card
          title="Salons les plus actifs"
          action={
            <div className="flex items-center gap-2">
              <SegmentedControl
                ariaLabel="Métrique — salons"
                value={channelMetric}
                onChange={setChannelMetric}
                options={[{ value: "messages", label: "Messages" }, { value: "voice", label: "Vocal" }]}
              />
              <SegmentedControl ariaLabel="Période — salons" value={channelDays} onChange={setChannelDays} options={dayOptions(1, 7, 30)} />
            </div>
          }
        >
          {channels.isPending ? (
            <ChartSkeleton height={280} />
          ) : channels.isError ? (
            <ErrorCard message="Impossible de charger l'activité des salons." onRetry={() => void channels.refetch()} />
          ) : channelMetric === "messages" ? (
            <ChannelBarChart data={channelData} color="#3e7afc" unit="messages" />
          ) : events.isError ? (
            <ErrorCard message="Impossible de charger les événements." onRetry={() => void events.refetch()} />
          ) : (
            <ChannelBarChart data={channelData} color="#7c4dee" unit="secondes" />
          )}
        </Card>

        <Card title="Événements à venir">
          {events.isPending ? (
            <ChartSkeleton height={200} />
          ) : (
            <EventsList events={events.data ?? []} channelName={channelName} />
          )}
        </Card>
      </div>
      )}
    </div>
  );
}
