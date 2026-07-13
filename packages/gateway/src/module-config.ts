import type { ModuleId } from "@bot/shared";
import type { GuildGatewayConfig } from "./worker-api.js";

/** Defaults to the pre-M03 behavior while a previous Worker version is active. */
export function isGatewayModuleEnabled(config: GuildGatewayConfig, moduleId: ModuleId): boolean {
  return config.modules?.[moduleId]?.enabled ?? true;
}
