import { describe, expect, it } from "vitest";
import type { StarboardSettingsDto } from "@bot/shared";
import {
  buildStarboardPreview,
  buildWelcomePreview,
  substituteWelcomeVariables,
  WELCOME_VARIABLES,
} from "../src/lib/community-preview.js";

const starboardSettings = (
  patch: Partial<StarboardSettingsDto> = {},
): StarboardSettingsDto => ({
  enabled: true,
  channelId: "123456789012345678",
  threshold: 3,
  emoji: "⭐",
  ...patch,
});

describe("aperçus communautaires locaux (Lot 5B)", () => {
  it("remplace toutes les variables de bienvenue, y compris leurs répétitions", () => {
    const message = `${WELCOME_VARIABLES.join(" · ")} · {mention}`;
    const projected = substituteWelcomeVariables(message);

    expect(projected.replacedVariables).toEqual(WELCOME_VARIABLES);
    expect(projected.rendered).not.toMatch(/\{(?:mention|user|user\.id|server|membercount)\}/);
    expect(projected.rendered.match(/@Camille \(démo\)/g)).toHaveLength(2);
    expect(projected.rendered).toContain("Atelier Archodev (démo)");
  });

  it("préserve le texte, les caractères spéciaux et les sauts de ligne", () => {
    const message = "Bienvenue «création» & entraide ✨\n<texte> {inconnue}";
    const projected = substituteWelcomeVariables(message);

    expect(projected.rendered).toBe(message);
    expect(projected.replacedVariables).toEqual([]);
  });

  it("expose les états vide, désactivé et texte long sans tronquer la donnée", () => {
    expect(buildWelcomePreview("welcome", true, "   ")).toMatchObject({
      kind: "welcome",
      enabled: true,
      empty: true,
      rendered: "   ",
    });

    const message = ("Ligne très longue — émoji 🛰️ {user}\n").repeat(70).slice(0, 2000);
    const preview = buildWelcomePreview("leave", false, message);
    expect(preview).toMatchObject({ kind: "leave", enabled: false, empty: false, raw: message });
    expect(preview.rendered).toContain("Camille (démo)");
    expect(preview.raw).toHaveLength(2000);
  });

  it("projette exactement le seuil, l’emoji et le salon du Starboard", () => {
    expect(buildStarboardPreview(starboardSettings({ threshold: 7, emoji: "🔥" }), "best-of")).toEqual({
      enabled: true,
      configured: true,
      emoji: "🔥",
      threshold: 7,
      targetChannel: "best-of",
      reactionLabel: "🔥 7",
    });
  });

  it("représente une configuration Starboard incomplète sans inventer de donnée distante", () => {
    expect(buildStarboardPreview(
      starboardSettings({ enabled: false, channelId: null, emoji: " " }),
      null,
    )).toEqual({
      enabled: false,
      configured: false,
      emoji: "⭐",
      threshold: 3,
      targetChannel: null,
      reactionLabel: "⭐ 3",
    });
  });

  it("borne uniquement la projection d’un seuil invalide sans modifier le brouillon", () => {
    const tooHigh = starboardSettings({ threshold: 99 });
    expect(buildStarboardPreview(tooHigh, "best-of").threshold).toBe(50);
    expect(tooHigh.threshold).toBe(99);

    expect(buildStarboardPreview(starboardSettings({ threshold: Number.NaN }), "best-of").threshold).toBe(1);
  });
});
