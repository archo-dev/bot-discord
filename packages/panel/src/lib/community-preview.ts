import type { StarboardSettingsDto } from "@bot/shared";

export const WELCOME_VARIABLES = [
  "{mention}",
  "{user}",
  "{user.id}",
  "{server}",
  "{membercount}",
] as const;

const DEMO_VARIABLES: Record<(typeof WELCOME_VARIABLES)[number], string> = {
  "{mention}": "@Camille (démo)",
  "{user}": "Camille (démo)",
  "{user.id}": "123456789012345678 (démo)",
  "{server}": "Atelier Archodev (démo)",
  "{membercount}": "1 234 (démo)",
};

export interface WelcomeMessagePreviewModel {
  readonly kind: "welcome" | "leave";
  readonly enabled: boolean;
  readonly empty: boolean;
  readonly raw: string;
  readonly rendered: string;
  readonly replacedVariables: readonly string[];
}

export function substituteWelcomeVariables(message: string): {
  rendered: string;
  replacedVariables: string[];
} {
  let rendered = message;
  const replacedVariables: string[] = [];
  for (const variable of WELCOME_VARIABLES) {
    if (!rendered.includes(variable)) continue;
    replacedVariables.push(variable);
    rendered = rendered.split(variable).join(DEMO_VARIABLES[variable]);
  }
  return { rendered, replacedVariables };
}

export function buildWelcomePreview(
  kind: "welcome" | "leave",
  enabled: boolean,
  message: string,
): WelcomeMessagePreviewModel {
  const projected = substituteWelcomeVariables(message);
  return {
    kind,
    enabled,
    empty: message.trim().length === 0,
    raw: message,
    rendered: projected.rendered,
    replacedVariables: projected.replacedVariables,
  };
}

export interface StarboardPreviewModel {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly emoji: string;
  readonly threshold: number;
  readonly targetChannel: string | null;
  readonly reactionLabel: string;
}

export function buildStarboardPreview(
  settings: StarboardSettingsDto,
  targetChannel: string | null,
): StarboardPreviewModel {
  const threshold = Number.isFinite(settings.threshold)
    ? Math.min(50, Math.max(1, Math.round(settings.threshold)))
    : 1;
  const emoji = settings.emoji.trim();
  return {
    enabled: settings.enabled,
    configured: Boolean(settings.channelId && emoji),
    emoji: emoji || "⭐",
    threshold,
    targetChannel,
    reactionLabel: `${emoji || "⭐"} ${threshold}`,
  };
}
