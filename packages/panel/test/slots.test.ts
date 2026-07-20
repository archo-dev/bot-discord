import { describe, expect, it } from "vitest";
import { resolveSlotAssignments, type AssignmentCandidate } from "@bot/shared";
import {
  assignmentStateLabel,
  availableSlots,
  planDisplayName,
  slotSummaryLabel,
} from "../src/lib/slots.js";

/* Cible @bot/shared : réconciliation PURE des emplacements (M7) + helpers panel. */

function cand(guildId: string, recencyAt: string): AssignmentCandidate {
  return { guildId, recencyAt };
}

describe("resolveSlotAssignments (M7)", () => {
  it("garde tout actif quand la capacité suffit", () => {
    const r = resolveSlotAssignments([cand("a", "2026-01-01T00:00:00Z"), cand("b", "2026-01-02T00:00:00Z")], 3);
    expect(r.active.sort()).toEqual(["a", "b"]);
    expect(r.suspended).toEqual([]);
  });

  it("downgrade 5→3 : garde les 3 plus récentes, suspend les 2 plus anciennes", () => {
    const list = [
      cand("g1", "2026-01-01T00:00:00Z"),
      cand("g2", "2026-01-02T00:00:00Z"),
      cand("g3", "2026-01-03T00:00:00Z"),
      cand("g4", "2026-01-04T00:00:00Z"),
      cand("g5", "2026-01-05T00:00:00Z"),
    ];
    const r = resolveSlotAssignments(list, 3);
    expect(r.active.sort()).toEqual(["g3", "g4", "g5"]);
    expect(r.suspended.sort()).toEqual(["g1", "g2"]);
  });

  it("capacité 0 → tout suspendu (plan expiré)", () => {
    const r = resolveSlotAssignments([cand("a", "2026-01-01T00:00:00Z")], 0);
    expect(r.active).toEqual([]);
    expect(r.suspended).toEqual(["a"]);
  });

  it("upgrade → réactive davantage d'emplacements", () => {
    const list = [cand("a", "2026-01-01T00:00:00Z"), cand("b", "2026-01-02T00:00:00Z"), cand("c", "2026-01-03T00:00:00Z")];
    expect(resolveSlotAssignments(list, 1).active).toEqual(["c"]);
    expect(resolveSlotAssignments(list, 5).active.sort()).toEqual(["a", "b", "c"]);
  });

  it("départage stable par guildId à récence égale", () => {
    const list = [cand("b", "2026-01-01T00:00:00Z"), cand("a", "2026-01-01T00:00:00Z")];
    const r = resolveSlotAssignments(list, 1);
    expect(r.active).toEqual(["a"]);
    expect(r.suspended).toEqual(["b"]);
  });

  it("est déterministe quel que soit l'ordre d'entrée", () => {
    const a = cand("a", "2026-01-01T00:00:00Z");
    const b = cand("b", "2026-01-05T00:00:00Z");
    expect(resolveSlotAssignments([a, b], 1)).toEqual(resolveSlotAssignments([b, a], 1));
    expect(resolveSlotAssignments([a, b], 1).active).toEqual(["b"]);
  });
});

describe("slot display helpers (M7)", () => {
  it("availableSlots ne descend jamais sous 0", () => {
    expect(availableSlots(2, 3)).toBe(1);
    expect(availableSlots(5, 3)).toBe(0);
    expect(availableSlots(0, 0)).toBe(0);
  });

  it("slotSummaryLabel accorde le pluriel", () => {
    expect(slotSummaryLabel(2, 3)).toBe("2 / 3 emplacements");
    expect(slotSummaryLabel(0, 1)).toBe("0 / 1 emplacement");
  });

  it("assignmentStateLabel et planDisplayName", () => {
    expect(assignmentStateLabel("active")).toBe("Actif");
    expect(assignmentStateLabel("suspended")).toBe("Suspendu");
    expect(planDisplayName("premium")).toBe("Premium");
    expect(planDisplayName("business")).toBe("Business");
    expect(planDisplayName("free")).toBe("Gratuit");
  });
});
