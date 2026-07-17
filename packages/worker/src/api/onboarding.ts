import { Hono, type Context } from "hono";
import {
  ONBOARDING_PRESETS,
  invitePermissionBitfield,
  invitePermissionUsage,
  type GuildModuleDto,
  type ModuleId,
  type OnboardingInvite,
  type OnboardingPresetId,
  type OnboardingResponse,
  type OnboardingStep,
  type OnboardingStepStatus,
} from "@bot/shared";
import type { Env } from "../env.js";
import type { AppContext } from "../auth/guard.js";
import { responseFor } from "./modules.js";
import { getGuild, getOnboardingProgress, parseDismissedSteps } from "../db/queries.js";

export const onboardingRouter = new Hono<AppContext>();

type OnboardingContext = Context<AppContext>;

/**
 * Modules a fresh server is walked through first — the highest-value toggleable
 * modules. Their checklist status is derived from the M03 module DTO, never
 * recomputed here (M06 §23).
 */
const STARTER_MODULES: readonly ModuleId[] = ["welcome", "automod", "levels", "tickets", "starboard", "temp_voice"];

/** One-time bot invite for this guild: minimal-yet-complete permissions, pre-targeted. */
function buildInvite(env: Env, guildId: string): OnboardingInvite {
  const permissions = invitePermissionBitfield().toString();
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    scope: "bot applications.commands",
    permissions,
    guild_id: guildId,
  });
  return { url: `https://discord.com/oauth2/authorize?${params}`, permissions, usage: invitePermissionUsage() };
}

function moduleStepStatus(dto: GuildModuleDto): OnboardingStepStatus {
  if (!dto.enabled) return "todo";
  if (dto.state === "enabled" || dto.state === "degraded") return "done";
  return "attention"; // enabled but misconfigured / missing permission / missing intent / gateway offline
}

/** Builds the derived checklist for a guild. Exported so the preset endpoint can reuse it. */
export async function buildOnboarding(c: OnboardingContext): Promise<OnboardingResponse> {
  const guildId = c.req.param("guildId")!;
  const [modules, guild, progress] = await Promise.all([
    responseFor(c),
    getGuild(c.env.DB, guildId),
    getOnboardingProgress(c.env.DB, guildId),
  ]);
  const byId = new Map(modules.modules.map((module) => [module.id, module]));

  const steps: OnboardingStep[] = [
    {
      id: "log_channel",
      title: "Salon de journaux",
      description: "Choisissez le salon où le bot publie ses journaux de modération et d'événements.",
      status: guild?.log_channel_id ? "done" : "todo",
      href: "config",
      dismissible: false,
    },
    {
      id: "gateway",
      title: "Service temps réel",
      description: "Le service Gateway alimente l'accueil, l'auto-modération, les niveaux, le vocal et les statistiques en temps réel.",
      status: modules.gateway.online ? "done" : "attention",
      href: "health",
      dismissible: false,
    },
    {
      id: "permissions",
      title: "Permissions Discord",
      description: "Vérifiez que le bot dispose des permissions requises par les modules que vous avez activés.",
      status: modules.modules.some((module) => module.enabled && module.state === "missing_permission") ? "attention" : "done",
      href: "modules",
      dismissible: false,
    },
  ];

  for (const id of STARTER_MODULES) {
    const dto = byId.get(id);
    if (!dto) continue;
    steps.push({
      id,
      title: `Configurer : ${dto.publicName}`,
      description: dto.description,
      status: moduleStepStatus(dto),
      href: dto.panel.configurePath,
      moduleId: id,
      dismissible: true,
    });
  }

  const dismissed = new Set(parseDismissedSteps(progress.onboarding_dismissed_steps));
  for (const step of steps) {
    if (step.dismissible && step.status !== "done" && dismissed.has(step.id)) step.status = "skipped";
  }

  const counted = steps.filter((step) => step.status !== "skipped");
  const done = counted.filter((step) => step.status === "done").length;

  return {
    generatedAt: new Date().toISOString(),
    completedAt: progress.onboarding_completed_at,
    appliedPreset: (progress.onboarding_preset as OnboardingPresetId | null) ?? null,
    dismissedSteps: [...dismissed],
    gatewayOnline: modules.gateway.online,
    canWrite: c.get("guildAccess") !== "panel_moderator",
    invite: buildInvite(c.env, guildId),
    steps,
    presets: ONBOARDING_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, description: preset.description, modules: [...preset.modules] })),
    progress: { done, total: counted.length },
  };
}

onboardingRouter.get("/guilds/:guildId/onboarding", async (c) => c.json(await buildOnboarding(c)));
