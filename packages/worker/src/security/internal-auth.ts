import type { MiddlewareHandler } from "hono";
import { sha256Hex, verifyInternalRequest } from "@bot/shared";
import type { Env } from "../env.js";

const ROUTES: ReadonlyArray<[string, RegExp]> = [
  ["GET", /^\/internal\/guilds\/\d{5,20}\/(config|commands)$/],
  ["GET", /^\/internal\/temp-voice\/channels$/],
  ["GET", /^\/internal\/guilds\/\d{5,20}\/temp-voice\/channels$/],
  ["GET", /^\/internal\/guilds\/\d{5,20}\/playlists\/[^/]+$/],
  ["POST", /^\/internal\/gateway\/heartbeat$/],
  ["POST", /^\/internal\/guilds\/\d{5,20}\/(installed|uninstalled|xp|voice-xp|starboard|music-state|playlists|automod-sanctions|voice-logs|mod-actions|member-snapshots|channel-activity|events)$/],
  ["POST", /^\/internal\/guilds\/\d{5,20}\/temp-voice\/(channels|lobby-deleted)$/],
  ["DELETE", /^\/internal\/guilds\/\d{5,20}\/temp-voice\/channels\/\d{5,20}$/],
];

export function isAllowedInternalRoute(method: string, path: string): boolean {
  return ROUTES.some(([allowedMethod, pattern]) => allowedMethod === method.toUpperCase() && pattern.test(path));
}

async function consumeNonce(db: D1Database, direction: string, nonce: string, timestamp: number): Promise<boolean> {
  const nonceHash = await sha256Hex(`${direction}:${nonce}`);
  const result = await db.prepare(
    `INSERT INTO internal_request_nonces (direction, nonce_hash, expires_at)
     VALUES (?1, ?2, datetime(?3, 'unixepoch', '+5 minutes'))
     ON CONFLICT(direction, nonce_hash) DO NOTHING`,
  ).bind(direction, nonceHash, timestamp).run();
  return (result.meta.changes ?? 0) === 1;
}

export const internalAuthentication: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (!isAllowedInternalRoute(c.req.method, path)) return c.json({ error: "not_found" }, 404);
  const mode = c.env.INTERNAL_AUTH_MODE ?? "dual";
  const hasSignature = c.req.header("x-internal-version") !== undefined;
  if (mode !== "legacy" && hasSignature) {
    const body = await c.req.raw.clone().text();
    const keys = [
      { keyId: c.env.INTERNAL_API_KEY_ID ?? "gw-current", masterSecret: c.env.INTERNAL_API_TOKEN },
      ...(c.env.INTERNAL_API_TOKEN_PREVIOUS
        ? [{ keyId: c.env.INTERNAL_API_PREVIOUS_KEY_ID ?? "gw-previous", masterSecret: c.env.INTERNAL_API_TOKEN_PREVIOUS }]
        : []),
    ];
    const verified = await verifyInternalRequest({
      headers: c.req.raw.headers,
      keys,
      direction: "gateway-to-worker",
      audience: "worker-internal",
      method: c.req.method,
      path: c.req.url,
      body,
    });
    if (!verified.ok) return c.json({ error: "invalid_internal_signature" }, 401);
    try {
      if (!(await consumeNonce(c.env.DB, "gateway-to-worker", verified.nonce, verified.timestamp))) {
        return c.json({ error: "internal_replay" }, 409);
      }
    } catch {
      return c.json({ error: "internal_auth_unavailable" }, 503);
    }
    await next();
    return;
  }
  if (mode === "signed") return c.json({ error: "signed_internal_auth_required" }, 401);
  const auth = c.req.header("authorization");
  const valid = auth === `Bearer ${c.env.INTERNAL_API_TOKEN}` ||
    (c.env.INTERNAL_API_TOKEN_PREVIOUS !== undefined && auth === `Bearer ${c.env.INTERNAL_API_TOKEN_PREVIOUS}`);
  if (!valid) return c.json({ error: "unauthorized" }, 401);
  await next();
};
