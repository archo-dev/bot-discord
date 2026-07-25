/*
 * Choke B — enforcement des plans sur les MUTATIONS panel (API).
 *
 * Middleware central monté sous /api/guilds/:guildId : toute écriture born-e est
 * mappée à une capability (jamais une simple protection frontend). En off/shadow
 * il ne bloque JAMAIS (il observe) ; seul `enforce` refuse (409). Le plan n'est
 * jamais lu du client — il est résolu D1 via le service central.
 */

import type { MiddlewareHandler } from "hono";
import {
  capabilityDenialMessageFr,
  moduleBaseCapability,
  type CapabilityId,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import type { Env } from "../env.js";
import { getEnforcementMode } from "../config/flags.js";
import { checkCapability } from "./service.js";
import { countCustomCommands, countActiveAutomationWorkflows, listPanelAccess } from "../db/queries.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Section d'URL (après le guildId) → module, pour dériver la capability de base. */
const SECTION_TO_MODULE: Readonly<Record<string, string>> = {
  warnings: "moderation", "mod-actions": "moderation", sanctions: "moderation", apply: "moderation",
  commands: "custom_commands",
  automations: "automations",
  tickets: "tickets",
  "button-roles": "button_roles",
  welcome: "welcome", "auto-roles": "welcome",
  automod: "automod", "automod-settings": "automod",
  "xp-settings": "levels", leaderboard: "levels", xp: "levels", levels: "levels",
  "starboard-settings": "starboard", starboard: "starboard",
  "temp-voice-settings": "temp_voice", "temp-voice": "temp_voice", tempvoice: "temp_voice",
  music: "music",
  "voice-logs": "voice_logs", voicelog: "voice_logs",
  stats: "stats",
  "panel-access": "panel_access", access: "panel_access",
  audit: "audit",
  config: "general", nickname: "general", "log-settings": "general", modules: "general",
  backup: "general", privacy: "general", onboarding: "general",
};

interface ApiCapabilityTarget {
  capability: CapabilityId;
  /** Compte l'usage courant pour une capacité quotée (create). */
  usage?: (env: Env, guildId: string) => Promise<number>;
}

/**
 * Résout la capability (+ usage éventuel) d'une mutation panel. Les CREATE quotés
 * (POST commandes/automations/délégués) portent un compteur ; le reste retombe
 * sur la capacité « .use » du module (Free → autorisée). `null` = non gardée.
 */
export function apiCapabilityTarget(method: string, section: string): ApiCapabilityTarget | null {
  // Créations quotées.
  if (section === "commands" && method === "POST") {
    return { capability: "custom_commands.create", usage: (env, g) => countCustomCommands(env.DB, g) };
  }
  if (section === "automations" && method === "POST") {
    return { capability: "automations.active", usage: (env, g) => countActiveAutomationWorkflows(env.DB, g) };
  }
  if (section === "panel-access" && method === "POST") {
    return { capability: "panel_access.delegate", usage: async (env, g) => (await listPanelAccess(env.DB, g)).length };
  }
  const moduleId = SECTION_TO_MODULE[section];
  if (!moduleId) return null;
  const capability = moduleBaseCapability(moduleId);
  return capability ? { capability } : null;
}

/** Extrait la section d'URL après `/guilds/:guildId/`. */
function sectionOf(pathname: string): string | null {
  const m = pathname.match(/\/guilds\/\d{5,20}\/([^/?]+)/);
  return m ? m[1]! : null;
}

export const enforceCapabilityPolicy: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!WRITE_METHODS.has(c.req.method)) return next();
  const mode = getEnforcementMode(c.env);
  if (mode === "off") return next();

  const guildId = c.req.param("guildId");
  const section = sectionOf(new URL(c.req.url).pathname);
  if (!guildId || !section) return next();
  const target = apiCapabilityTarget(c.req.method, section);
  if (!target) return next();

  const usage = target.usage ? await target.usage(c.env, guildId) : null;
  const decision = await checkCapability(c.env, {
    surface: "api",
    guildId,
    capability: target.capability,
    usage,
    waitUntil: (p) => c.executionCtx.waitUntil(p),
  });
  if (!decision.allowed) {
    return c.json(
      { error: decision.reason === "quota_exceeded" ? "quota_exceeded" : "plan_required", message: capabilityDenialMessageFr(decision), decision: { requiredPlan: decision.requiredPlan, effectivePlan: decision.effectivePlan, quota: decision.quota, usage: decision.usage, reason: decision.reason } },
      403,
    );
  }
  await next();
};
