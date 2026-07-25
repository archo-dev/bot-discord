import type { MiddlewareHandler } from "hono";
import { moduleBaseCapability, type ModuleId } from "@bot/shared";
import type { Env } from "../env.js";
import { isGuildModuleEnabled } from "../db/queries.js";
import { getEnforcementMode } from "../config/flags.js";
import { checkCapability } from "../enforcement/service.js";

/** Defense in depth for signed Gateway writes; disabled modules are idempotently skipped. */
export function requireInternalModule(moduleId: ModuleId): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const guildId = c.req.param("guildId");
    if (guildId && !(await isGuildModuleEnabled(c.env.DB, guildId, moduleId))) {
      return c.json({ ok: true, skipped: true, reason: "module_disabled" });
    }
    // Choke D — enforcement des plans sur les écritures internes. off/shadow
    // n'interceptent jamais ; enforce saute idempotemment l'écriture hors plan.
    const capability = moduleBaseCapability(moduleId);
    if (guildId && capability && getEnforcementMode(c.env) !== "off") {
      const decision = await checkCapability(c.env, {
        surface: "internal",
        guildId,
        capability,
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      });
      if (!decision.allowed) return c.json({ ok: true, skipped: true, reason: "plan_required" });
    }
    await next();
  };
}
