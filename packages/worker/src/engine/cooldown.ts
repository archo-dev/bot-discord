import type { Env } from "../env.js";

const key = (guildId: string, commandId: number, scope: "user" | "guild", userId: string): string =>
  `cd:${guildId}:${commandId}:${scope === "user" ? userId : "guild"}`;

/**
 * Remaining cooldown in seconds (0 = not on cooldown). KV TTL floor is 60s,
 * so the expiry timestamp lives in the value and is compared here.
 */
export async function remainingCooldown(
  env: Env,
  guildId: string,
  commandId: number,
  scope: "user" | "guild",
  userId: string,
): Promise<number> {
  const raw = await env.KV.get(key(guildId, commandId, scope, userId));
  if (!raw) return 0;
  const expiresAt = Number(raw);
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

export async function startCooldown(
  env: Env,
  guildId: string,
  commandId: number,
  scope: "user" | "guild",
  userId: string,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) return;
  await env.KV.put(key(guildId, commandId, scope, userId), String(Date.now() + seconds * 1000), {
    expirationTtl: Math.max(seconds, 60),
  });
}
