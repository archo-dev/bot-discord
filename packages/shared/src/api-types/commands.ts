/** Custom command CRUD + revision DTOs. */

import type { CommandLogic } from "../command-logic.js";

export interface CustomCommandDto {
  id: number;
  guildId: string;
  name: string;
  description: string;
  triggerType: "slash" | "keyword";
  enabled: boolean;
  logic: CommandLogic;
  cooldownSeconds: number;
  cooldownScope: "user" | "guild";
  requiredPermissions: string | null;
  discordCommandId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
  /** True when the trigger needs the (not yet deployed) gateway service. */
  gatewayRequired: boolean;
}

export interface CustomCommandUpsert {
  name: string;
  description: string;
  logic: CommandLogic;
}

export interface CommandRevisionDto {
  id: number;
  commandId: number;
  changeType: "create" | "update" | "enable" | "disable" | "delete";
  logic: CommandLogic;
  changedBy: string;
  changedAt: string;
}
