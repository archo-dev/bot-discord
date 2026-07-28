import type {
  ChannelStatEntry,
  MemberDeltaPoint,
  MemberSnapshotPoint,
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

export interface MemberPopulation {
  readonly total: number;
  readonly humans: number | null;
  readonly bots: number | null;
}

const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

const validCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

const validWholeCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

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

export function resolveMemberPopulation(
  overviewTotal: number | null | undefined,
  snapshots: readonly MemberSnapshotPoint[],
): MemberPopulation | null {
  const latest = snapshots.at(-1);
  const snapshotTotal = validWholeCount(latest?.total);
  const total = validWholeCount(overviewTotal) ?? snapshotTotal;
  if (total === null) return null;

  const humans = validWholeCount(latest?.humans);
  const bots = validWholeCount(latest?.bots);
  const hasExactBreakdown =
    snapshotTotal === total &&
    humans !== null &&
    bots !== null &&
    humans + bots === total;

  return {
    total,
    humans: hasExactBreakdown ? humans : null,
    bots: hasExactBreakdown ? bots : null,
  };
}

function normalizeActivePresences(active: readonly number[], total: number): number[] {
  const activeTotal = active.reduce((sum, value) => sum + value, 0);
  if (activeTotal <= total) return [...active];
  if (total === 0 || activeTotal === 0) return active.map(() => 0);

  const scaled = active.map((value, index) => {
    const exact = (value * total) / activeTotal;
    const floor = Math.floor(exact);
    return { index, floor, remainder: exact - floor };
  });
  let remaining = total - scaled.reduce((sum, value) => sum + value.floor, 0);
  for (const value of [...scaled].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining === 0) break;
    value.floor += 1;
    remaining -= 1;
  }
  return scaled.sort((a, b) => a.index - b.index).map((value) => value.floor);
}

export function buildPresenceChartData(
  presence: Partial<Record<keyof PresenceStatsDto, number | null | undefined>>,
  population: MemberPopulation | null,
): { total: number; slices: PresenceChartSlice[]; summary: string } {
  if (population === null) {
    const slices = PRESENCE_META.map((item) => ({ ...item, value: 0, percentage: 0 }));
    return { total: 0, slices, summary: "Le total des membres n’est pas disponible." };
  }

  const total = population.total;
  const active = normalizeActivePresences(
    ["online", "idle", "dnd"].map((id) => validWholeCount(presence[id as keyof PresenceStatsDto]) ?? 0),
    total,
  );
  const offline = Math.max(0, total - active.reduce((sum, value) => sum + value, 0));
  const counts = [...active, offline];
  const values = PRESENCE_META.map((item, index) => ({ ...item, value: counts[index]! }));
  const slices = values.map((item) => ({
    ...item,
    percentage: total === 0 ? 0 : (item.value / total) * 100,
  }));
  const summary = total === 0
    ? "Total 0 membre : En ligne 0 (0 %), Absent 0 (0 %), Ne pas déranger 0 (0 %), Hors ligne 0 (0 %)."
    : `Total ${numberFormat.format(total)} membres${population.humans !== null && population.bots !== null
      ? `, dont ${numberFormat.format(population.humans)} humains et ${numberFormat.format(population.bots)} bots`
      : ""} : ${slices
      .map((slice) => `${slice.label} ${numberFormat.format(slice.value)} (${numberFormat.format(slice.percentage)} %)`)
      .join(", ")}.`;
  return { total, slices, summary };
}

export function rankedSummary(
  data: readonly RankedChartDatum[],
  unit: string,
  sourceCount = data.length,
  formatValue?: (value: number) => string,
): string {
  if (data.length === 0) return "Aucune valeur comparable n’est disponible.";
  const leader = data[0]!;
  const coverage = sourceCount > data.length
    ? ` ${data.length} élément${data.length > 1 ? "s" : ""} sur ${sourceCount} dispose${data.length > 1 ? "nt" : ""} d’une valeur comparable.`
    : "";
  const value = formatValue?.(leader.value) ?? `${numberFormat.format(leader.value)}${unit ? ` ${unit}` : ""}`;
  return `${leader.label} arrive en tête avec ${value}.${coverage}`;
}
