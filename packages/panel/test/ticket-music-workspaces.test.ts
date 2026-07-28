import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TICKET_FORM, type TicketSettingsUpdate } from "@bot/shared";
import { buildTicketPanelPreview, validateTicketSettingsDraft } from "../src/lib/ticket-preview.js";
import {
  formatMusicDuration,
  musicLoopLabel,
  musicSourceLabel,
  musicStatusLabel,
} from "../src/lib/music-view.js";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("ticket workspace projections", () => {
  it("builds an entirely local panel preview from the draft", () => {
    const preview = buildTicketPanelPreview(" Support ", " Besoin d’aide ", true, DEFAULT_TICKET_FORM);
    expect(preview).toMatchObject({
      title: "Support",
      description: "Besoin d’aide",
      emptyTitle: false,
      emptyDescription: false,
    });
    expect(preview.opener.kind).toBe("button");
    expect(preview.questions).toHaveLength(2);
  });

  it("uses explicit empty labels instead of inventing content", () => {
    const preview = buildTicketPanelPreview(" ", "", false, DEFAULT_TICKET_FORM);
    expect(preview.title).toBe("Titre non renseigné");
    expect(preview.description).toBe("Description non renseignée");
    expect(preview.emptyTitle).toBe(true);
    expect(preview.emptyDescription).toBe(true);
    expect(preview.questions).toEqual([]);
  });

  it("represents multiple categories with the existing select behavior", () => {
    const form = {
      ...DEFAULT_TICKET_FORM,
      categories: [
        DEFAULT_TICKET_FORM.categories[0]!,
        { id: "billing", label: "Facturation", description: "Paiement", emoji: "💳" },
      ],
    };
    const preview = buildTicketPanelPreview("Support", "Description", true, form);
    expect(preview.opener.kind).toBe("select");
    expect(preview.opener.categories.map((category) => category.id)).toEqual(["general", "billing"]);
  });

  it("validates only documented local form constraints", () => {
    const draft: TicketSettingsUpdate = {
      enabled: true,
      categoryId: null,
      staffRoleIds: [],
      transcriptChannelId: null,
      formEnabled: true,
      form: {
        ...DEFAULT_TICKET_FORM,
        categories: [{ ...DEFAULT_TICKET_FORM.categories[0]!, label: " " }],
        fields: [{ ...DEFAULT_TICKET_FORM.fields[0]!, label: "" }],
      },
    };
    const validation = validateTicketSettingsDraft(draft);
    expect(validation.errors["category-0-label"]).toContain("obligatoire");
    expect(validation.errors["field-0-label"]).toContain("obligatoire");
    expect(validation.errors.categoryId).toBeUndefined();
  });
});

describe("music workspace projections", () => {
  it("formats real durations and live values", () => {
    expect(formatMusicDuration(0)).toBe("Live");
    expect(formatMusicDuration(65)).toBe("1:05");
    expect(formatMusicDuration(3661)).toBe("1:01:01");
  });

  it("derives status, loop and source labels without fake metadata", () => {
    expect(musicStatusLabel("playing")).toBe("En lecture");
    expect(musicStatusLabel("error")).toBe("Erreur de lecture");
    expect(musicLoopLabel("queue")).toBe("Répéter la file");
    expect(musicSourceLabel("https://www.soundcloud.com/artist/track")).toBe("Source : soundcloud.com");
    expect(musicSourceLabel(null)).toBe("Source non disponible");
  });
});

describe("ticket and music client contracts", () => {
  const tickets = read("../src/pages/Tickets.tsx");
  const music = read("../src/pages/Music.tsx");
  const search = read("../src/components/MusicSearchPanel.tsx");

  it("keeps the existing Tickets endpoints and protects its configuration draft", () => {
    expect(tickets).toContain("/tickets/settings");
    expect(tickets).toContain("/tickets/panel");
    expect(tickets).toContain("/tickets/stats");
    expect(tickets).toContain("<SaveBar");
    expect(tickets).toContain("useDirty(");
    expect(tickets).toContain("<TicketPanelPreview");
  });

  it("keeps the existing real-time Music endpoints without a fake settings contract", () => {
    expect(music).toContain("/music-state");
    expect(music).toContain("/music-control");
    expect(music).not.toContain("music-settings");
    expect(music).not.toContain("<SaveBar");
    expect(music).not.toContain("useDirty(");
  });

  it("preserves every supported queue and playback action", () => {
    expect(music).toContain('s!.paused ? "resume" : "pause"');
    for (const action of ["skip", "stop", "shuffle", "volume", "repeat", "remove", "seek"]) {
      expect(music).toContain(`action: "${action}"`);
    }
  });

  it("keeps bounded, cancellable search and the existing enqueue endpoint", () => {
    expect(search).toContain("MusicSearchCoordinator");
    expect(search).toContain("MusicSubmissionGuard");
    expect(search).toContain("/music-search");
    expect(search).toContain("/music-enqueue");
    expect(search).toContain("result.url ?? resolvedQuery");
  });
});
