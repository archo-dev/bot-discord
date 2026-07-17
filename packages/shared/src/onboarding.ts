import type { ModuleId } from "./modules.js";

/**
 * Onboarding presets. Each preset only ever *enables* a curated set of toggleable
 * modules — it never disables anything and never writes channel/role config, so it
 * can be applied on top of an existing server without clobbering it (see M06 §13).
 * The admin still configures each module afterwards; the checklist guides them.
 */
export const ONBOARDING_PRESET_IDS = ["community", "moderation", "support"] as const;
export type OnboardingPresetId = (typeof ONBOARDING_PRESET_IDS)[number];

export interface OnboardingPreset {
  id: OnboardingPresetId;
  name: string;
  description: string;
  /** Toggleable public modules this preset switches on. All must be `toggleable: true`. */
  modules: readonly ModuleId[];
}

export const ONBOARDING_PRESETS: readonly OnboardingPreset[] = [
  {
    id: "community",
    name: "Communauté",
    description: "Accueil des membres, niveaux, starboard et vocaux temporaires pour un serveur communautaire vivant.",
    modules: ["welcome", "levels", "starboard", "temp_voice", "button_roles"],
  },
  {
    id: "moderation",
    name: "Modération",
    description: "Auto-modération, tickets de support et journalisation vocale pour garder le serveur sûr.",
    modules: ["automod", "tickets", "voice_logs"],
  },
  {
    id: "support",
    name: "Support",
    description: "Tickets, accueil et commandes personnalisées pour un serveur orienté aide et FAQ.",
    modules: ["tickets", "welcome", "custom_commands"],
  },
] as const;

export function getOnboardingPreset(id: OnboardingPresetId): OnboardingPreset {
  return ONBOARDING_PRESETS.find((preset) => preset.id === id)!;
}
