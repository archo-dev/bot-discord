/** Worker-side platform feature flags (M6). Resolves the shared flag catalog
 * from Worker env vars. Every flag defaults OFF (unset var → false), so the
 * production behavior is unchanged until a var is explicitly declared/set. */

import { resolveFlags, type FlagState } from "@bot/shared";
import type { Env } from "../env.js";

function isTrue(value: string | undefined): boolean {
  return value === "true";
}

/** Resolved flag state for this request/env. Unknown/absent vars → catalog default (false). */
export function getWorkerFlags(env: Env): FlagState {
  return resolveFlags({
    "platform.entitlements": isTrue(env.PLATFORM_ENTITLEMENTS),
    "platform.billing": isTrue(env.PLATFORM_BILLING),
    "platform.support": isTrue(env.PLATFORM_SUPPORT),
  });
}
