/** Cohort rollout store (M15). KV-backed (no D1) so a flag can be enabled for
 * pilot guilds WITHOUT a redeploy. Keys: `platform:rollout:<flag>` → JSON
 * { global?: boolean; guilds: string[] }. Default (absent) = off, empty cohort:
 * an additive, opt-in mechanism that never changes existing behavior on its own. */

export interface RolloutState {
  global: boolean;
  guilds: string[];
}

const KEY = (flag: string) => `platform:rollout:${flag}`;
const SNOWFLAKE = /^\d{5,20}$/;

function sanitize(raw: unknown): RolloutState {
  const obj = (raw ?? {}) as { global?: unknown; guilds?: unknown };
  const guilds = Array.isArray(obj.guilds) ? obj.guilds.filter((g): g is string => typeof g === "string" && SNOWFLAKE.test(g)) : [];
  return { global: obj.global === true, guilds: [...new Set(guilds)] };
}

export async function getRollout(kv: KVNamespace, flag: string): Promise<RolloutState> {
  const raw = await kv.get(KEY(flag));
  if (!raw) return { global: false, guilds: [] };
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return { global: false, guilds: [] };
  }
}

/** Persist a rollout state (sanitized). An empty, non-global state effectively clears it. */
export async function setRollout(kv: KVNamespace, flag: string, state: RolloutState): Promise<RolloutState> {
  const clean = sanitize(state);
  await kv.put(KEY(flag), JSON.stringify(clean));
  return clean;
}

export async function listRollout(kv: KVNamespace, flags: readonly string[]): Promise<Record<string, RolloutState>> {
  const out: Record<string, RolloutState> = {};
  await Promise.all(flags.map(async (f) => { out[f] = await getRollout(kv, f); }));
  return out;
}
