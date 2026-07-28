import type { GuildOverview, MemberStatsDto, PresenceStatsDto } from "@bot/shared";
import {
  NAVIGATION_REGISTRY,
  isDestinationAvailable,
  type NavigationAvailability,
} from "../navigation/registry.js";
import type { IconName } from "../ui/icons.js";
import type { ChartPeriod } from "../lib/chart-data.js";

export interface DashboardKpi {
  readonly id: "members" | "online" | "messages" | "alerts";
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly icon: IconName;
  readonly tone: "violet" | "green" | "blue" | "amber";
  readonly unavailable: boolean;
}

export interface MemberActivitySummary {
  readonly available: boolean;
  readonly joins: number;
  readonly leaves: number;
  readonly net: number;
  readonly latestTotal: number | null;
}

export interface PresenceSlice {
  readonly id: keyof PresenceStatsDto;
  readonly label: string;
  readonly value: number;
  readonly tone: "green" | "amber" | "red" | "gray";
}

export interface DashboardQuickAction {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon: IconName;
  readonly gatewayRequired: boolean;
  readonly gatewayAvailable: boolean;
}

const numberFormat = new Intl.NumberFormat("fr-FR");

export function memberTrend(stats: MemberStatsDto | undefined): number | null {
  const snapshots = stats?.snapshots ?? [];
  if (snapshots.length < 2) return null;
  return snapshots[snapshots.length - 1]!.total - snapshots[0]!.total;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${numberFormat.format(value)}`;
}

export function buildDashboardKpis(
  guild: GuildOverview,
  members: MemberStatsDto | undefined,
  presence: PresenceStatsDto | null | undefined,
  memberPeriod: ChartPeriod = 7,
): DashboardKpi[] {
  const trend = memberTrend(members);
  return [
    {
      id: "members",
      label: "Membres",
      value: guild.approximateMemberCount == null ? "—" : numberFormat.format(guild.approximateMemberCount),
      hint:
        guild.approximateMemberCount == null
          ? "Estimation Discord non disponible"
          : trend == null
            ? "Estimation Discord · évolution non disponible"
            : `Estimation Discord · ${signed(trend)} sur ${memberPeriod} jours`,
      icon: "users",
      tone: "violet",
      unavailable: guild.approximateMemberCount == null,
    },
    {
      id: "online",
      label: "En ligne",
      value: presence == null ? "—" : numberFormat.format(presence.online),
      hint: presence == null ? "Non disponible sans présence Gateway" : "Présence actuelle déclarée par Discord",
      icon: "pulse",
      tone: "green",
      unavailable: presence == null,
    },
    {
      id: "messages",
      label: "Messages 24 h",
      value: "—",
      hint: "Total exact indisponible",
      icon: "message",
      tone: "blue",
      unavailable: true,
    },
    {
      id: "alerts",
      label: "Alertes ouvertes",
      value: "—",
      hint: "Aucun domaine d’alertes persistantes configuré",
      icon: "alert",
      tone: "amber",
      unavailable: true,
    },
  ];
}

export function summarizeMemberActivity(stats: MemberStatsDto | undefined): MemberActivitySummary {
  if (!stats || (stats.snapshots.length === 0 && stats.deltas.length === 0)) {
    return { available: false, joins: 0, leaves: 0, net: 0, latestTotal: null };
  }
  const joins = stats.deltas.reduce((total, point) => total + point.joins, 0);
  const leaves = stats.deltas.reduce((total, point) => total + point.leaves, 0);
  return {
    available: true,
    joins,
    leaves,
    net: joins - leaves,
    latestTotal: stats.snapshots.at(-1)?.total ?? null,
  };
}

export function buildPresenceSlices(presence: PresenceStatsDto): PresenceSlice[] {
  return [
    { id: "online", label: "En ligne", value: presence.online, tone: "green" },
    { id: "idle", label: "Absent", value: presence.idle, tone: "amber" },
    { id: "dnd", label: "Ne pas déranger", value: presence.dnd, tone: "red" },
    { id: "offline", label: "Hors ligne", value: presence.offline, tone: "gray" },
  ];
}

const QUICK_ACTIONS = [
  { id: "welcome", label: "Bienvenue" },
  { id: "roles", label: "Rôles" },
  { id: "automod", label: "Auto-mod" },
  { id: "commands", label: "Commandes" },
  { id: "tickets", label: "Tickets" },
  { id: "settings", label: "Paramètres" },
] as const;

export function buildQuickActions(availability: NavigationAvailability): DashboardQuickAction[] {
  return QUICK_ACTIONS.flatMap((item) => {
    const destination = NAVIGATION_REGISTRY.find((candidate) => candidate.id === item.id);
    if (!destination || !isDestinationAvailable(destination, availability)) return [];
    return [{
      id: destination.id,
      label: item.label,
      path: destination.primaryPath,
      icon: destination.icon,
      gatewayRequired: destination.gateway === "required",
      gatewayAvailable: destination.gateway !== "required" || availability.gatewayConnected,
    }];
  });
}

export function latestDashboardUpdate(timestamps: readonly number[]): number | null {
  const available = timestamps.filter((value) => Number.isFinite(value) && value > 0);
  return available.length === 0 ? null : Math.max(...available);
}
