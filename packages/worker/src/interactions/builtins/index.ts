import type { APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
import type { Env } from "../../env.js";
import { pingHandler } from "./ping.js";

export interface BuiltinContext {
  env: Env;
  interaction: APIChatInputApplicationCommandInteraction;
  /** Schedule work to run after the (deferred) response is returned. */
  waitUntil: (promise: Promise<unknown>) => void;
}

export type BuiltinHandler = (ctx: BuiltinContext) => Promise<Response>;

/** Registry of built-in slash commands. Moderation handlers land in M6. */
export const builtins: Record<string, BuiltinHandler> = {
  ping: pingHandler,
};
