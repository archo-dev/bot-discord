import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  ONBOARDING_PRESETS,
  ONBOARDING_PRESET_IDS,
  PRODUCT_STEP_VALUES,
  getOnboardingPreset,
  invitePermissionBitfield,
  invitePermissionUsage,
  type GuildModuleDto,
  type GuildModulesResponse,
  type ModuleId,
  type OnboardingInvite,
  type OnboardingPreset,
  type OnboardingPresetEntry,
  type OnboardingPresetId,
  type OnboardingPresetPreview,
  type OnboardingPresetResult,
  type OnboardingResponse,
  type OnboardingStep,
  type OnboardingStepStatus,
} from "@bot/shared";
import type { Env } from "../env.js";
import type { AppContext } from "../auth/guard.js";
import { responseFor } from "./modules.js";
import {
  applyOnboardingPresetStatement,
  getGuild,
  getOnboardingProgress,
  markOnboardingComplete,
  parseDismissedSteps,
  setOnboardingDismissedSteps,
  syncGuildModuleStatement,
} from "../db/queries.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";
import { recordProductMetric } from "../analytics/service.js";

export const onboardingRouter = new Hono<AppContext>();

type OnboardingContext = Context<AppContext>;

/**
 * Modules a fresh server is walked through first — the highest-value toggleable
 * modules. Their checklist status is derived from the M03 module DTO, never
 * recomputed here (M06 §23).
 */
const STARTER_MODULES: readonly ModuleId[] = ["welcome", "automod", "levels", "tickets", "starboard", "temp_voice"];

/**
 * Bot invite with minimal-yet-complete permissions. `guildId` pre-targets the guild
 * (used inside the panel to re-invite / grant missing permissions); omit it for the
 * public landing, where Discord shows the server picker.
 */
export function buildInvite(env: Env, guildId?: string): OnboardingInvite {
  const permissions = invitePermissionBitfield().toString();
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    scope: "bot applications.commands",
    permissions,
  });
  if (guildId) params.set("guild_id", guildId);
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

// --- Presets ----------------------------------------------------------------

/**
 * Diff of what applying a preset would change. Preset modules have no
 * inter-dependencies, so each is evaluated independently against the current
 * module DTO: `canEnable` already folds in prerequisites, gateway and permissions.
 */
function previewPreset(modules: GuildModulesResponse, preset: OnboardingPreset): OnboardingPresetEntry[] {
  return preset.modules.map((id) => {
    const dto = modules.modules.find((module) => module.id === id)!;
    if (dto.enabled) return { moduleId: id, publicName: dto.publicName, action: "already_enabled", reason: null };
    if (dto.actions.canEnable) return { moduleId: id, publicName: dto.publicName, action: "enable", reason: null };
    return { moduleId: id, publicName: dto.publicName, action: "blocked", reason: dto.activationReasons[0] ?? null };
  });
}

const presetSchema = z.object({ preset: z.enum(ONBOARDING_PRESET_IDS), dryRun: z.boolean().optional() });

onboardingRouter.post("/guilds/:guildId/onboarding/preset", rateLimit({ name: "onboarding-preset", limit: 10 }), async (c) => {
  const parsed = presetSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const preset = getOnboardingPreset(parsed.data.preset);
  const modules = await responseFor(c);
  const entries = previewPreset(modules, preset);

  if (parsed.data.dryRun) {
    const preview: OnboardingPresetPreview = { preset: preset.id, entries, applicable: entries.some((entry) => entry.action === "enable") };
    return c.json(preview);
  }

  // Only the modules that pass prerequisites are toggled; blocked ones are reported
  // as skipped. Nothing outside the preset's module set is touched.
  const guildId = c.req.param("guildId")!;
  const toEnable = entries.filter((entry) => entry.action === "enable").map((entry) => entry.moduleId);
  const statements = [
    ...toEnable.map((id) => syncGuildModuleStatement(c.env.DB, guildId, id, true)),
    applyOnboardingPresetStatement(c.env.DB, guildId, preset.id),
  ];
  await c.env.DB.batch(statements);
  await recordProductMetric(c.env, guildId, {
    event: "onboarding_completed", module: null, step: "preset", outcome: "completed",
  }).catch(() => false);

  const result: OnboardingPresetResult = {
    preset: preset.id,
    enabled: toEnable,
    skipped: entries.filter((entry) => entry.action === "blocked" && entry.reason).map((entry) => ({ moduleId: entry.moduleId, reason: entry.reason! })),
    completedAt: new Date().toISOString(),
  };
  return c.json(result);
});

// --- Checklist progress -----------------------------------------------------

const dismissSchema = z.object({ step: z.string().min(1).max(40) });

onboardingRouter.post("/guilds/:guildId/onboarding/dismiss", rateLimit({ name: "onboarding-dismiss", limit: 30 }), async (c) => {
  const parsed = dismissSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const guildId = c.req.param("guildId")!;

  if (parsed.data.step === "__complete__") {
    await markOnboardingComplete(c.env.DB, guildId);
    await recordProductMetric(c.env, guildId, {
      event: "onboarding_completed", module: null, step: "checklist", outcome: "completed",
    }).catch(() => false);
  } else {
    const progress = await getOnboardingProgress(c.env.DB, guildId);
    const steps = new Set(parseDismissedSteps(progress.onboarding_dismissed_steps));
    steps.add(parsed.data.step);
    await setOnboardingDismissedSteps(c.env.DB, guildId, [...steps]);
    const knownStep = PRODUCT_STEP_VALUES.find((step) => step === parsed.data.step);
    if (knownStep) await recordProductMetric(c.env, guildId, {
      event: "onboarding_step", module: null, step: knownStep, outcome: "dismissed",
    }).catch(() => false);
  }
  return c.json(await buildOnboarding(c));
});
