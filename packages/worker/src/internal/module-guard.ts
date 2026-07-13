import type { MiddlewareHandler } from "hono";
import type { ModuleId } from "@bot/shared";
import type { Env } from "../env.js";
import { isGuildModuleEnabled } from "../db/queries.js";

/** Defense in depth for signed Gateway writes; disabled modules are idempotently skipped. */
export function requireInternalModule(moduleId: ModuleId): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const guildId = c.req.param("guildId");
    if (guildId && !(await isGuildModuleEnabled(c.env.DB, guildId, moduleId))) {
      return c.json({ ok: true, skipped: true, reason: "module_disabled" });
    }
    await next();
  };
}
