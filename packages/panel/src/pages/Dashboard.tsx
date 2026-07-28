import { useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type {
  GuildHealthResponse,
  MemberStatsDto,
  ModActionDto,
  Paginated,
  PresenceStatsDto,
  ScheduledEventDto,
} from "@bot/shared";
import { DashboardGrid, type DashboardResource } from "../components/dashboard/DashboardGrid.js";
import { DashboardHeader } from "../components/dashboard/DashboardHeader.js";
import { api, ApiError } from "../lib/api.js";
import type { ChartPeriod } from "../lib/chart-data.js";
import { PanelErrorBoundary } from "../ui/error-boundary.js";
import { SkeletonDashboard } from "../ui/skeleton.js";
import { buildDashboardKpis, latestDashboardUpdate } from "./dashboard-view-model.js";
import type { GuildOutletContext } from "./GuildLayout.js";

export function Dashboard() {
  const { guildId = "" } = useParams<{ guildId: string }>();
  const { guild, availability, guildUpdatedAt, refreshGuild } = useOutletContext<GuildOutletContext>();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshAnnouncement, setRefreshAnnouncement] = useState("");
  const [activityPeriod, setActivityPeriod] = useState<ChartPeriod>(7);

  const members = useQuery({
    queryKey: ["stats-members", guildId, activityPeriod],
    queryFn: ({ signal }) => api<MemberStatsDto>(`/api/guilds/${guildId}/stats/members?days=${activityPeriod}`, { signal }),
    enabled: Boolean(guildId),
  });
  const presence = useQuery({
    queryKey: ["stats-presence", guildId],
    queryFn: ({ signal }) => api<PresenceStatsDto | null>(`/api/guilds/${guildId}/stats/presence`, { signal }),
    enabled: Boolean(guildId),
  });
  const events = useQuery({
    queryKey: ["stats-events", guildId],
    queryFn: ({ signal }) => api<ScheduledEventDto[]>(`/api/guilds/${guildId}/stats/events`, { signal }),
    enabled: Boolean(guildId),
  });
  const health = useQuery({
    queryKey: ["health", guildId],
    queryFn: ({ signal }) => api<GuildHealthResponse>(`/api/guilds/${guildId}/health`, { signal }),
    enabled: Boolean(guildId) && availability.canWrite,
  });
  const moderation = useQuery({
    queryKey: ["mod-actions", guildId, "page=1"],
    queryFn: ({ signal }) => api<Paginated<ModActionDto>>(`/api/guilds/${guildId}/mod-actions?page=1`, { signal }),
    enabled: Boolean(guildId),
  });

  if (!guild) return <SkeletonDashboard />;

  const healthAccessDenied =
    !availability.canWrite || (health.error instanceof ApiError && health.error.status === 403);
  const updatedAt = latestDashboardUpdate([
    guildUpdatedAt,
    members.dataUpdatedAt,
    presence.dataUpdatedAt,
    events.dataUpdatedAt,
    health.dataUpdatedAt,
    moderation.dataUpdatedAt,
  ]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshAnnouncement("Actualisation du dashboard en cours.");
    const requests: Promise<unknown>[] = [
      refreshGuild(),
      members.refetch(),
      presence.refetch(),
      events.refetch(),
      moderation.refetch(),
    ];
    if (availability.canWrite) requests.push(health.refetch());
    await Promise.allSettled(requests);
    setRefreshing(false);
    setRefreshAnnouncement("Actualisation terminée. Chaque bloc affiche son dernier état disponible.");
  };

  const resource = <T,>(
    query: {
      data: T | undefined;
      isPending: boolean;
      error: Error | null;
      refetch: () => Promise<unknown>;
    },
  ): DashboardResource<T> => ({
    data: query.data,
    pending: query.isPending,
    error: query.error,
    retry: () => void query.refetch(),
  });

  return (
    <div className="space-y-4">
      <DashboardHeader
        guildName={guild.name}
        gatewayConnected={guild.gatewayConnected}
        updatedAt={updatedAt}
        refreshing={refreshing}
        refreshAnnouncement={refreshAnnouncement}
        onRefresh={() => void refresh()}
      />
      <PanelErrorBoundary zone="widget" resetKey={`${guildId}:${activityPeriod}`}>
        <DashboardGrid
          guildId={guildId}
          memberTotal={guild.approximateMemberCount}
          gatewayConnected={guild.gatewayConnected}
          availability={availability}
          activityPeriod={activityPeriod}
          onActivityPeriodChange={setActivityPeriod}
          kpis={buildDashboardKpis(guild, members.data, presence.data, activityPeriod)}
          members={resource(members)}
          presence={resource(presence)}
          events={resource(events)}
          health={resource(health)}
          healthAccessDenied={healthAccessDenied}
          moderation={resource(moderation)}
        />
      </PanelErrorBoundary>
    </div>
  );
}
