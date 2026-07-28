import { describe, expect, it } from "vitest";
import type { MemberDeltaPoint, ScheduledEventDto } from "@bot/shared";
import {
  buildActivitySeries,
  buildPresenceChartData,
  rankChannels,
  rankScheduledEvents,
  rankedSummary,
  resolveMemberPopulation,
  summarizeActivity,
  type ChartPeriod,
} from "../src/lib/chart-data.js";

const deltas: MemberDeltaPoint[] = [
  { day: "2026-07-03", joins: 4, leaves: 1 },
  { day: "2026-07-01", joins: 2, leaves: 3 },
  { day: "2026-07-02", joins: 8, leaves: 2 },
];

const event = (id: string, name: string, interestedCount: number | null): ScheduledEventDto => ({
  id,
  name,
  description: null,
  scheduledStartTime: `2026-08-0${id}T18:00:00.000Z`,
  scheduledEndTime: null,
  channelId: null,
  location: "Discord",
  interestedCount,
});

describe("chart data", () => {
  it("sorts and sanitizes real member movements", () => {
    expect(buildActivitySeries([
      ...deltas,
      { day: "invalid", joins: 99, leaves: 99 },
      { day: "2026-07-04", joins: -2, leaves: Number.NaN },
    ])).toEqual([
      { day: "2026-07-01", arrivals: 2, departures: 3, total: 5 },
      { day: "2026-07-02", arrivals: 8, departures: 2, total: 10 },
      { day: "2026-07-03", arrivals: 4, departures: 1, total: 5 },
      { day: "2026-07-04", arrivals: 0, departures: 0, total: 0 },
    ]);
  });

  it.each([7, 30, 90] satisfies ChartPeriod[])("keeps the selected %i-day period explicit", (period) => {
    const summary = summarizeActivity(buildActivitySeries(deltas), period);
    expect(summary.partial).toBe(true);
    expect(summary.observedDays).toBe(3);
    expect(summary.total).toBe(20);
    expect(summary.average).toBeCloseTo(20 / 3);
    expect(summary.text).toContain(`sur les ${period} jours demandés`);
    expect(summary.text).toContain("par jour observé");
  });

  it("does not invent a trend for an empty or partial series", () => {
    const empty = summarizeActivity([], 7);
    expect(empty).toMatchObject({ empty: true, average: null, peak: null });
    expect(empty.text).toContain("Aucun mouvement");

    const partial = summarizeActivity(buildActivitySeries([{ day: "2026-07-01", joins: 1, leaves: 0 }]), 7);
    expect(partial.text).toContain("1 journée avec des mouvements");
    expect(partial.text).not.toContain("tendance");
  });

  it("sorts scheduled Discord events and excludes unknown values honestly", () => {
    const source = [event("1", "Atelier", 12), event("2", "Questions", null), event("3", "Rencontre", 24)];
    const ranked = rankScheduledEvents(source);
    expect(ranked.map((item) => [item.label, item.value])).toEqual([["Rencontre", 24], ["Atelier", 12]]);
    expect(rankedSummary(ranked, "intéressé(s)", source.length)).toContain("2 éléments sur 3");
  });

  it("sorts horizontal channel bars in descending order", () => {
    const ranked = rankChannels(
      [
        { channelId: "2", value: 5 },
        { channelId: "1", value: 30 },
        { channelId: "3", value: 12 },
      ],
      (id) => ({ "1": "général", "2": "aide", "3": "vocal" })[id] ?? id,
    );
    expect(ranked.map((item) => item.label)).toEqual(["#général", "#vocal", "#aide"]);
  });

  it("uses the authoritative 95-member total and derives the offline segment", () => {
    const population = resolveMemberPopulation(95, [
      { bucket: "2026-07-28T08:00", total: 95, humans: 93, bots: 2 },
    ]);
    const presence = buildPresenceChartData({ online: 4, idle: 1, dnd: 2, offline: 47 }, population);
    expect(presence.total).toBe(95);
    expect(presence.slices.map((slice) => [slice.id, slice.value])).toEqual([
      ["online", 4],
      ["idle", 1],
      ["dnd", 2],
      ["offline", 88],
    ]);
    expect(presence.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(95);
    expect(presence.slices.map((slice) => [slice.id, slice.percentage])).toEqual([
      ["online", (4 / 95) * 100],
      ["idle", (1 / 95) * 100],
      ["dnd", (2 / 95) * 100],
      ["offline", (88 / 95) * 100],
    ]);
    expect(presence.summary).toContain("Total 95 membres, dont 93 humains et 2 bots");
    expect(presence.summary).toContain("Hors ligne 88 (92,6 %)");
  });

  it("keeps missing presences, all-offline, all-online and zero totals coherent", () => {
    const population = resolveMemberPopulation(95, []);
    const missing = buildPresenceChartData({}, population);
    expect(missing.slices.map((slice) => slice.value)).toEqual([0, 0, 0, 95]);

    const noneOnline = buildPresenceChartData({ online: 0, idle: 0, dnd: 0 }, population);
    expect(noneOnline.slices.map((slice) => slice.value)).toEqual([0, 0, 0, 95]);

    const allOnline = buildPresenceChartData({ online: 95, idle: 0, dnd: 0 }, population);
    expect(allOnline.slices.map((slice) => slice.value)).toEqual([95, 0, 0, 0]);

    const empty = buildPresenceChartData({ online: 20, idle: null, dnd: undefined, offline: 80 }, {
      total: 0,
      humans: 0,
      bots: 0,
    });
    expect(empty.total).toBe(0);
    expect(empty.slices.map((slice) => slice.value)).toEqual([0, 0, 0, 0]);
    expect(empty.slices.every((slice) => slice.percentage === 0)).toBe(true);
    expect(empty.summary).toContain("Total 0 membre");
  });

  it("normalizes temporarily excessive or invalid presences without negatives or double-counting", () => {
    const normalized = buildPresenceChartData(
      { online: 100, idle: 50, dnd: 25, offline: Number.POSITIVE_INFINITY },
      { total: 95, humans: null, bots: null },
    );
    expect(normalized.slices.map((slice) => slice.value)).toEqual([54, 27, 14, 0]);
    expect(normalized.slices.every((slice) => slice.value >= 0)).toBe(true);
    expect(normalized.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(95);

    const invalid = buildPresenceChartData(
      { online: -1, idle: Number.NaN, dnd: 2.9, offline: 500 },
      { total: 5, humans: null, bots: null },
    );
    expect(invalid.slices.map((slice) => slice.value)).toEqual([0, 0, 2, 3]);
  });

  it("only announces an exact human/bot breakdown matching the selected total", () => {
    const matching = resolveMemberPopulation(null, [
      { bucket: "2026-07-28T08:00", total: 95, humans: 93, bots: 2 },
    ]);
    expect(matching).toEqual({ total: 95, humans: 93, bots: 2 });

    const stale = resolveMemberPopulation(96, [
      { bucket: "2026-07-28T08:00", total: 95, humans: 93, bots: 2 },
    ]);
    expect(stale).toEqual({ total: 96, humans: null, bots: null });
    expect(buildPresenceChartData({}, stale).summary).not.toContain("dont");

    expect(buildPresenceChartData({}, null)).toMatchObject({
      total: 0,
      summary: "Le total des membres n’est pas disponible.",
    });
  });
});
