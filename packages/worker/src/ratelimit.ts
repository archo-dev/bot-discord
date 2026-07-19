import type { MiddlewareHandler } from "hono";
import type { AppContext } from "./auth/guard.js";

/**
 * Fixed-window KV rate limiter. Best-effort by design (KV is eventually
 * consistent across PoPs) — good enough to stop abusive bursts on sensitive
 * endpoints. windowSeconds must be >= 60 (KV TTL floor).
 */
export function rateLimit(opts: {
  name: string;
  limit: number;
  windowSeconds?: number;
  /** Keeps one guild's traffic from consuming another guild's local allowance. */
  scope?: "user" | "user-guild";
  /** Returns the remaining fixed-window delay and a Retry-After header. */
  exactRetryAfter?: boolean;
}): MiddlewareHandler<AppContext> {
  const windowSeconds = Math.max(opts.windowSeconds ?? 60, 60);
  return async (c, next) => {
    const session = c.get("session");
    const actorKey = session ? session.userId : (c.req.header("cf-connecting-ip") ?? "anon");
    const scopeKey = opts.scope === "user-guild"
      ? `${actorKey}:${c.req.param("guildId") ?? "no-guild"}`
      : actorKey;
    const windowMs = windowSeconds * 1000;
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const kvKey = `rl:${opts.name}:${scopeKey}:${window}`;

    const current = Number((await c.env.KV.get(kvKey)) ?? "0");
    if (current >= opts.limit) {
      const retryAfterSeconds = opts.exactRetryAfter
        ? Math.max(1, Math.ceil((((window + 1) * windowMs) - now) / 1000))
        : windowSeconds;
      if (opts.exactRetryAfter) c.header("Retry-After", String(retryAfterSeconds));
      return c.json({ error: "rate_limited", retryAfterSeconds }, 429);
    }
    await c.env.KV.put(kvKey, String(current + 1), { expirationTtl: windowSeconds * 2 });
    await next();
  };
}
