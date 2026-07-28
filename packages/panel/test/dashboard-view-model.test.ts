import { describe, expect, it } from "vitest";
import type { GuildOverview, MemberStatsDto, PresenceStatsDto } from "@bot/shared";
import {
  buildDashboardKpis,
  buildPresenceSlices,
  buildQuickActions,
  latestDashboardUpdate,
  memberTrend,
  summarizeMemberActivity,
} from "../src/pages/dashboard-view-model.js";

const guild: GuildOverview = {
  id: "123456789",
  name: "Archodev",
  icon: null,
  approximateMemberCount: 1_248,
  logChannelId: null,
  warnThreshold: 3,
  warnTimeoutMinutes: 60,
  customNickname: null,
  mentionCards: false,
  gatewayConnected: true,
  access: "admin",
};

const members: MemberStatsDto = {
  snapshots: [
    { bucket: "2026-07-21T00:00", total: 1_200, humans: 1_100, bots: 100 },
    { bucket: "2026-07-28T00:00", total: 1_248, humans: 1_143, bots: 105 },
  ],
  deltas: [
    { day: "2026-07-27", joins: 12, leaves: 4 },
    { day: "2026-07-28", joins: 9, leaves: 3 },
  ],
};

const presence: PresenceStatsDto = { online: 324, idle: 21, dnd: 9, offline: 894 };

describe("dashboard view model", () => {
  it("uses only exact or explicitly approximate member and presence values", () => {
    const metrics = buildDashboardKpis(guild, members, presence);
    expect(metrics.map((metric) => [metric.label, metric.value])).toEqual([
      ["Membres", "1 248"],
      ["En ligne", "324"],
      ["Messages 24 h", "—"],
      ["Alertes ouvertes", "—"],
    ]);
    expect(metrics[0]?.hint).toContain("+48 sur 7 jours");
  });

  it("never turns partial sources into message or persistent-alert totals", () => {
    const metrics = buildDashboardKpis(guild, members, presence);
    expect(metrics.find((metric) => metric.id === "messages")).toMatchObject({
      value: "—",
      hint: "Total exact indisponible",
      unavailable: true,
    });
    expect(metrics.find((metric) => metric.id === "alerts")).toMatchObject({
      value: "—",
      hint: "Aucun domaine d’alertes persistantes configuré",
      unavailable: true,
    });
  });

  it("exposes missing presence honestly", () => {
    const online = buildDashboardKpis({ ...guild, gatewayConnected: false }, members, null)[1];
    expect(online).toMatchObject({ value: "—", unavailable: true });
    expect(online?.hint).toContain("Non disponible");
  });

  it("summarizes only the seven-day member source", () => {
    expect(memberTrend(members)).toBe(48);
    expect(summarizeMemberActivity(members)).toEqual({
      available: true,
      joins: 21,
      leaves: 7,
      net: 14,
      latestTotal: 1_248,
    });
    expect(summarizeMemberActivity({ snapshots: [], deltas: [] }).available).toBe(false);
  });

  it("keeps presence categories textual for the future chart", () => {
    expect(buildPresenceSlices(presence)).toEqual([
      { id: "online", label: "En ligne", value: 324, tone: "green" },
      { id: "idle", label: "Absent", value: 21, tone: "amber" },
      { id: "dnd", label: "Ne pas déranger", value: 9, tone: "red" },
      { id: "offline", label: "Hors ligne", value: 894, tone: "gray" },
    ]);
  });

  it("derives quick actions from the navigation registry and current availability", () => {
    const online = buildQuickActions({ canWrite: true, gatewayConnected: true, flags: {} });
    const offlineModerator = buildQuickActions({ canWrite: false, gatewayConnected: false, flags: {} });
    expect(online.map((action) => action.id)).toEqual(["welcome", "roles", "automod", "commands", "tickets", "settings"]);
    expect(offlineModerator).toHaveLength(online.length);
    expect(offlineModerator.find((action) => action.id === "welcome")?.gatewayAvailable).toBe(false);
  });

  it("reports the newest successful source timestamp", () => {
    expect(latestDashboardUpdate([0, 100, Number.NaN, 250, 200])).toBe(250);
    expect(latestDashboardUpdate([0, Number.NaN])).toBeNull();
  });
});
