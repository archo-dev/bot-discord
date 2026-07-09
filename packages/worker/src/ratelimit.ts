import type { MiddlewareHandler } from "hono";
import type { AppContext } from "./auth/guard.js";

/**
 * Fixed-window KV rate limiter. Best-effort by design (KV is eventually
 * consistent across PoPs) — good enough to stop abusive bursts on sensitive
 * endpoints. windowSeconds must be >= 60 (KV TTL floor).
 */
export function rateLimit(opts: { name: string; limit: number; windowSeconds?: number }): MiddlewareHandler<AppContext> {
  const windowSeconds = Math.max(opts.windowSeconds ?? 60, 60);
  return async (c, next) => {
    const session = c.get("session");
    const key = session ? session.userId : (c.req.header("cf-connecting-ip") ?? "anon");
    const window = Math.floor(Date.now() / (windowSeconds * 1000));
    const kvKey = `rl:${opts.name}:${key}:${window}`;

    const current = Number((await c.env.KV.get(kvKey)) ?? "0");
    if (current >= opts.limit) {
      return c.json({ error: "rate_limited", retryAfterSeconds: windowSeconds }, 429);
    }
    await c.env.KV.put(kvKey, String(current + 1), { expirationTtl: windowSeconds * 2 });
    await next();
  };
}
