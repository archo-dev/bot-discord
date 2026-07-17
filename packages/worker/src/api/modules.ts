import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  MODULE_DEFINITIONS,
  MODULE_IDS,
  MODULE_REGISTRY,
  evaluateModuleState,
  type CapabilityEntitlement,
  type GatewayModuleRuntimeResponse,
  type GuildModuleDto,
  type GuildModulesResponse,
  type ModuleId,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import {
  getModuleConfigurationSignals,
  listEffectiveGuildModules,
  setGuildModuleEnabled,
  type GuildModuleRow,
  type ModuleConfigurationSignals,
} from "../db/queries.js";
import { fetchGatewayModuleRuntime } from "../gateway/forward.js";
import { recordProductMetric } from "../analytics/service.js";

export const modulesRouter = new Hono<AppContext>();
const moduleIdSchema = z.enum(MODULE_IDS);
const patchSchema = z.object({ enabled: z.boolean() });

const CONFIG_SIGNAL_MODULES = new Set<ModuleId>(["tickets", "welcome", "automod", "levels", "starboard", "temp_voice"]);

function configurationComplete(moduleId: ModuleId, signals: ModuleConfigurationSignals): boolean {
  return CONFIG_SIGNAL_MODULES.has(moduleId) ? signals[moduleId as keyof ModuleConfigurationSignals] : true;
}

type ModulesContext = Context<AppContext>;

async function gatewayContext(c: ModulesContext): Promise<{
  online: boolean;
  runtime: GatewayModuleRuntimeResponse | null;
}> {
  const raw = await c.env.KV.get("gateway:status");
  let online = false;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { at?: unknown };
      online = typeof parsed.at === "number" && Date.now() - parsed.at <= 180_000;
    } catch {
      online = false;
    }
  }
  const guildId = c.req.param("guildId");
  return { online, runtime: online && guildId ? await fetchGatewayModuleRuntime(c.env, guildId) : null };
}

function entitlements(definition: (typeof MODULE_DEFINITIONS)[number], state: GuildModuleDto["state"], canWrite: boolean): CapabilityEntitlement[] {
  const values = [definition.capabilities.read, definition.capabilities.configure, definition.capabilities.execute, definition.capabilities.toggle].filter(
    (capability): capability is NonNullable<typeof capability> => capability !== null,
  );
  return values.map((capability) => {
    const kind = capability.split(".").at(-1);
    const granted = kind === "read" || (kind === "configure" ? canWrite : kind === "toggle" ? canWrite && definition.toggleable : state === "enabled" || state === "degraded");
    return { capability, granted, source: kind === "read" ? "platform" : kind === "execute" ? "runtime" : "guild_configuration", reasonCode: granted ? null : state === "disabled" ? "module_disabled" : null };
  });
}

function buildModuleDto(input: {
  row: GuildModuleRow;
  rows: GuildModuleRow[];
  signals: ModuleConfigurationSignals;
  gatewayOnline: boolean;
  runtime: GatewayModuleRuntimeResponse | null;
  canWrite: boolean;
}): GuildModuleDto {
  const definition = MODULE_REGISTRY[input.row.module_id];
  const enabledById = Object.fromEntries(input.rows.map((row) => [row.module_id, row.enabled === 1]));
  const runtime = input.runtime;
  const evaluated = evaluateModuleState(definition, {
    enabled: input.row.enabled === 1,
    configVersion: input.row.config_version,
    configurationComplete: configurationComplete(definition.id, input.signals),
    dependencyEnabled: enabledById,
    gatewayOnline: input.gatewayOnline,
    knownIntents: runtime?.intents ?? null,
    missingPermissions: runtime?.permissionsKnown ? (runtime.missingPermissions[definition.id] ?? []) : null,
  });
  const prospective = input.row.enabled === 1 ? evaluated : evaluateModuleState(definition, {
    enabled: true,
    configVersion: input.row.config_version,
    configurationComplete: configurationComplete(definition.id, input.signals),
    dependencyEnabled: enabledById,
    gatewayOnline: input.gatewayOnline,
    knownIntents: runtime?.intents ?? null,
    missingPermissions: runtime?.permissionsKnown ? (runtime.missingPermissions[definition.id] ?? []) : null,
  });
  const blocked = new Set(["unavailable", "misconfigured", "missing_dependency", "missing_permission", "missing_intent", "gateway_offline", "incompatible_config", "degraded"]);
  return {
    id: definition.id,
    publicName: definition.publicName,
    description: definition.description,
    category: definition.category,
    enabled: input.row.enabled === 1,
    state: evaluated.state,
    reasons: evaluated.reasons,
    activationReasons: prospective.reasons,
    configVersion: input.row.config_version,
    currentConfigVersion: definition.configVersion,
    toggleable: definition.toggleable,
    dependencies: [...definition.dependencies],
    requiredIntents: [...definition.requiredIntents],
    requiredPermissions: [...definition.requiredPermissions],
    gateway: definition.gateway,
    healthModule: definition.healthModule,
    quotas: [...definition.quotas],
    entitlements: entitlements(definition, evaluated.state, input.canWrite),
    capabilities: definition.capabilities,
    panel: definition.panel,
    actions: {
      canEnable: input.canWrite && definition.toggleable && input.row.enabled !== 1 && !blocked.has(prospective.state),
      canDisable: input.canWrite && definition.toggleable && input.row.enabled === 1,
      canConfigure: input.canWrite && definition.capabilities.configure !== null && definition.panel.configurePath !== null,
    },
    disableConsequence: definition.disableConsequence,
  };
}

export async function responseFor(c: ModulesContext, override?: { moduleId: ModuleId; enabled: boolean }): Promise<GuildModulesResponse> {
  const guildId = c.req.param("guildId")!;
  const [rows, signals, gateway] = await Promise.all([
    listEffectiveGuildModules(c.env.DB, guildId),
    getModuleConfigurationSignals(c.env.DB, guildId),
    gatewayContext(c),
  ]);
  const effectiveRows = override
    ? rows.map((row) => row.module_id === override.moduleId ? { ...row, enabled: override.enabled ? 1 : 0 } : row)
    : rows;
  const canWrite = c.get("guildAccess") !== "panel_moderator";
  return {
    governanceVersion: 1,
    generatedAt: new Date().toISOString(),
    gateway: { online: gateway.online, runtimeChecksAvailable: gateway.runtime !== null },
    modules: effectiveRows.map((row) => buildModuleDto({ row, rows: effectiveRows, signals, gatewayOnline: gateway.online, runtime: gateway.runtime, canWrite })),
  };
}

modulesRouter.get("/guilds/:guildId/modules", async (c) => c.json(await responseFor(c)));

modulesRouter.patch("/guilds/:guildId/modules/:moduleId", async (c) => {
  const parsedId = moduleIdSchema.safeParse(c.req.param("moduleId"));
  if (!parsedId.success) return c.json({ error: "unknown_module" }, 404);
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const definition = MODULE_REGISTRY[parsedId.data];
  if (!definition.toggleable) return c.json({ error: "module_not_toggleable" }, 409);

  if (parsed.data.enabled) {
    const current = await responseFor(c, { moduleId: parsedId.data, enabled: true });
    const module = current.modules.find((candidate) => candidate.id === parsedId.data)!;
    const blockingStates = new Set(["misconfigured", "missing_dependency", "missing_permission", "missing_intent", "gateway_offline", "incompatible_config", "unavailable"]);
    if (blockingStates.has(module.state)) return c.json({ error: "module_prerequisite_failed", state: module.state, reasons: module.reasons }, 409);
    if ((definition.gateway === "required" || definition.requiredPermissions.length > 0) && !current.gateway.runtimeChecksAvailable) {
      return c.json({ error: "module_prerequisite_unknown", reasons: [{ code: "runtime_check_unavailable" }] }, 409);
    }
  }

  await setGuildModuleEnabled(c.env.DB, c.req.param("guildId")!, parsedId.data, parsed.data.enabled);
  await recordProductMetric(c.env, c.req.param("guildId")!, {
    event: "module_activation_changed", module: parsedId.data, step: null,
    outcome: parsed.data.enabled ? "enabled" : "disabled",
  }).catch(() => false);
  const updated = await responseFor(c);
  return c.json(updated.modules.find((candidate) => candidate.id === parsedId.data)!);
});
