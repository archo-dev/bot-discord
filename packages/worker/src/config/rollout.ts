/** Cohort-aware flag resolution (M15). Opt-in: combines the global worker flag
 * (env, getWorkerFlags) with the KV rollout cohort (resolveRollout). Existing
 * synchronous flag consumers are deliberately NOT rewired — this is available
 * for guild-scoped rollout when a milestone chooses to adopt it. Default
 * (global off + empty cohort) → false, i.e. no behavior change. */

import { resolveRollout, type PlatformFlagKey } from "@bot/shared";
import type { Env } from "../env.js";
import { getWorkerFlags } from "./flags.js";
import { getRollout } from "../db/queries/rollout.js";

/** True when the flag is globally on OR the guild is in the KV pilot cohort. */
export async function resolveGuildFlag(
  env: Env,
  kv: KVNamespace,
  flag: PlatformFlagKey,
  guildId: string | null | undefined,
): Promise<boolean> {
  if (getWorkerFlags(env)[flag]) return true;
  const rollout = await getRollout(kv, flag);
  return resolveRollout({ globalOn: rollout.global, cohortGuilds: rollout.guilds, guildId });
}
