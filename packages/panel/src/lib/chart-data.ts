import type {
  ChannelStatEntry,
  MemberDeltaPoint,
  PresenceStatsDto,
  ScheduledEventDto,
} from "@bot/shared";

export type ChartPeriod = 7 | 30 | 90;

export interface ActivityChartPoint {
  readonly day: string;
  readonly arrivals: number;
  readonly departures: number;
  readonly total: number;
}

export interface ActivitySummary {
  readonly empty: boolean;
  readonly partial: boolean;
  readonly observedDays: number;
  readonly total: number;
  readonly average: number | null;
  readonly peak: ActivityChartPoint | null;
  readonly text: string;
}

export interface RankedChartDatum {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly detail?: string;
}

export interface PresenceChartSlice {
  readonly id: keyof PresenceStatsDto;
  readonly label: string;
  readonly value: number;
  readonly percentage: number;
  readonly color: string;
}

const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

const validCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

export function buildActivitySeries(deltas: readonly MemberDeltaPoint[]): ActivityChartPoint[] {
  const byDay = new Map<string, ActivityChartPoint>();
  for (const point of deltas) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.day)) continue;
    const arrivals = validCount(point.joins);
    const departures = validCount(point.leaves);
    byDay.set(point.day, { day: point.day, arrivals, departures, total: arrivals + departures });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function formatChartDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function summarizeActivity(
  points: readonly ActivityChartPoint[],
  period: ChartPeriod,
): ActivitySummary {
  if (points.length === 0) {
    return {
      empty: true,
      partial: false,
      observedDays: 0,
      total: 0,
      average: null,
      peak: null,
      text: `Aucun mouvement de membre n’est disponible sur la période de ${period} jours.`,
    };
  }
  const total = points.reduce((sum, point) => sum + point.total, 0);
  const average = total / points.length;
  const peak = points.reduce<ActivityChartPoint | null>(
    (current, point) => current === null || point.total > current.total ? point : current,
    null,
  );
  const partial = points.length < period;
  const coverage = partial
    ? `${points.length} journée${points.length > 1 ? "s" : ""} avec des mouvements sur les ${period} jours demandés`
    : `les ${period} derniers jours`;
  const peakText = peak && peak.total > 0
    ? ` Le pic observé est le ${formatChartDay(peak.day)} avec ${numberFormat.format(peak.total)} mouvement${peak.total > 1 ? "s" : ""}.`
    : "";
  return {
    empty: false,
    partial,
    observedDays: points.length,
    total,
    average,
    peak,
    text: `Sur ${coverage}, la moyenne est de ${numberFormat.format(average)} mouvement${average > 1 ? "s" : ""} par jour observé.${peakText}`,
  };
}

export function rankScheduledEvents(events: readonly ScheduledEventDto[]): RankedChartDatum[] {
  return events
    .filter((event) => event.interestedCount != null && Number.isFinite(event.interestedCount) && event.interestedCount >= 0)
    .map((event) => ({
      id: event.id,
      label: event.name,
      value: event.interestedCount!,
      detail: formatEventDate(event.scheduledStartTime),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "fr"));
}

export function rankChannels(
  channels: readonly ChannelStatEntry[],
  channelName: (channelId: string) => string,
): RankedChartDatum[] {
  return channels
    .filter((channel) => Number.isFinite(channel.value) && channel.value >= 0)
    .map((channel) => ({
      id: channel.channelId,
      label: `#${channelName(channel.channelId)}`,
      value: channel.value,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "fr"));
}

function formatEventDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date non disponible";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PRESENCE_META: Array<{
  id: keyof PresenceStatsDto;
  label: string;
  color: string;
}> = [
  { id: "online", label: "En ligne", color: "#34d399" },
  { id: "idle", label: "Absent", color: "#fbbf24" },
  { id: "dnd", label: "Ne pas déranger", color: "#fb7185" },
  { id: "offline", label: "Hors ligne", color: "#71717a" },
];

export function buildPresenceChartData(
  presence: Partial<Record<keyof PresenceStatsDto, number | null | undefined>>,
): { total: number; slices: PresenceChartSlice[]; summary: string } {
  const values = PRESENCE_META.map((item) => ({ ...item, value: validCount(presence[item.id]) }));
  const total = values.reduce((sum, item) => sum + item.value, 0);
  const slices = values.map((item) => ({
    ...item,
    percentage: total === 0 ? 0 : (item.value / total) * 100,
  }));
  const summary = total === 0
    ? "Aucune présence n’est disponible."
    : `Total ${numberFormat.format(total)} membres : ${slices
      .map((slice) => `${slice.label} ${numberFormat.format(slice.value)} (${numberFormat.format(slice.percentage)} %)`)
      .join(", ")}.`;
  return { total, slices, summary };
}

export function rankedSummary(
  data: readonly RankedChartDatum[],
  unit: string,
  sourceCount = data.length,
): string {
  if (data.length === 0) return "Aucune valeur comparable n’est disponible.";
  const leader = data[0]!;
  const coverage = sourceCount > data.length
    ? ` ${data.length} élément${data.length > 1 ? "s" : ""} sur ${sourceCount} dispose${data.length > 1 ? "nt" : ""} d’une valeur comparable.`
    : "";
  return `${leader.label} arrive en tête avec ${numberFormat.format(leader.value)} ${unit}.${coverage}`;
}
