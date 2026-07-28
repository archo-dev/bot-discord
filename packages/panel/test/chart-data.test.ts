import { describe, expect, it } from "vitest";
import type { MemberDeltaPoint, ScheduledEventDto } from "@bot/shared";
import {
  buildActivitySeries,
  buildPresenceChartData,
  rankChannels,
  rankScheduledEvents,
  rankedSummary,
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

  it("computes a donut total and percentages from the four segments", () => {
    const presence = buildPresenceChartData({ online: 40, idle: 10, dnd: 0, offline: 50 });
    expect(presence.total).toBe(100);
    expect(presence.slices.map((slice) => [slice.id, slice.percentage])).toEqual([
      ["online", 40],
      ["idle", 10],
      ["dnd", 0],
      ["offline", 50],
    ]);
    expect(presence.summary).toContain("Ne pas déranger 0 (0 %)");
  });

  it("handles null and zero presence segments without an incoherent total", () => {
    const empty = buildPresenceChartData({ online: 0, idle: null, dnd: undefined, offline: 0 });
    expect(empty.total).toBe(0);
    expect(empty.slices.every((slice) => slice.percentage === 0)).toBe(true);
    expect(empty.summary).toBe("Aucune présence n’est disponible.");
  });
});
