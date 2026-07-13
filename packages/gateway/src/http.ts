import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Client } from "discord.js";
import { verifyInternalRequest, type MusicCommandPayload } from "@bot/shared";
import type { GatewayEnv } from "./env.js";
import type { MusicController } from "./music.js";

const MUSIC_COMMANDS = new Set([
  "play",
  "pause",
  "resume",
  "skip",
  "stop",
  "queue",
  "remove",
  "shuffle",
  "loop",
  "volume",
  "seek",
  "nowplaying",
  "playlist_save",
  "playlist_load",
]);

function parseMusicPayload(body: unknown): MusicCommandPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b["command"] !== "string" || !MUSIC_COMMANDS.has(b["command"])) return null;
  if (typeof b["guildId"] !== "string" || typeof b["userId"] !== "string" || typeof b["textChannelId"] !== "string") return null;
  if (b["source"] !== "interaction" && b["source"] !== "panel") return null;
  return {
    command: b["command"] as MusicCommandPayload["command"],
    guildId: b["guildId"],
    userId: b["userId"],
    textChannelId: b["textChannelId"],
    applicationId: typeof b["applicationId"] === "string" ? b["applicationId"] : null,
    token: typeof b["token"] === "string" ? b["token"] : null,
    arg: typeof b["arg"] === "string" ? b["arg"] : null,
    source: b["source"],
  };
}

/**
 * Gateway's own HTTP surface, reached only through the Cloudflare tunnel.
 * Bearer-guarded (GATEWAY_HTTP_TOKEN); the Worker calls it for the music
 * forward and panel-driven controls.
 */
export function createHttpApp(env: GatewayEnv, client: Client, music: MusicController): Hono {
  const app = new Hono();
  const usedNonces = new Map<string, number>();

  app.use("*", async (c, next) => {
    if (!((c.req.method === "GET" && c.req.path === "/health") || (c.req.method === "POST" && c.req.path === "/music"))) {
      return c.json({ error: "not_found" }, 404);
    }
    const mode = env.GATEWAY_INTERNAL_AUTH_MODE;
    const hasSignature = c.req.header("x-internal-version") !== undefined;
    if (mode !== "legacy" && hasSignature) {
      const body = await c.req.raw.clone().text();
      const verified = await verifyInternalRequest({
        headers: c.req.raw.headers,
        keys: [
          { keyId: env.GATEWAY_HTTP_KEY_ID, masterSecret: env.GATEWAY_HTTP_TOKEN },
          ...(env.GATEWAY_HTTP_TOKEN_PREVIOUS
            ? [{ keyId: env.GATEWAY_HTTP_PREVIOUS_KEY_ID, masterSecret: env.GATEWAY_HTTP_TOKEN_PREVIOUS }]
            : []),
        ],
        direction: "worker-to-gateway",
        audience: "gateway-http",
        method: c.req.method,
        path: c.req.url,
        body,
      });
      if (!verified.ok) return c.json({ error: "invalid_internal_signature" }, 401);
      const now = Math.floor(Date.now() / 1000);
      for (const [nonce, expires] of usedNonces) if (expires < now) usedNonces.delete(nonce);
      if (usedNonces.has(verified.nonce)) return c.json({ error: "internal_replay" }, 409);
      if (usedNonces.size >= 10_000) usedNonces.delete(usedNonces.keys().next().value!);
      usedNonces.set(verified.nonce, now + 300);
      await next();
      return;
    }
    if (mode === "signed") return c.json({ error: "signed_internal_auth_required" }, 401);
    const auth = c.req.header("authorization");
    const validLegacy = auth === `Bearer ${env.GATEWAY_HTTP_TOKEN}` ||
      (env.GATEWAY_HTTP_TOKEN_PREVIOUS !== undefined && auth === `Bearer ${env.GATEWAY_HTTP_TOKEN_PREVIOUS}`);
    if (!validLegacy) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.use("/music", bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: "body_too_large" }, 413) }));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      ready: client.isReady(),
      guildCount: client.guilds.cache.size,
      wsPing: client.ws.ping >= 0 ? client.ws.ping : null,
      uptimeSeconds: Math.floor(process.uptime()),
    }),
  );

  app.post("/music", async (c) => {
    const payload = parseMusicPayload(await c.req.json().catch(() => null));
    if (!payload) return c.json({ error: "invalid_body" }, 400);

    // Interaction commands were already deferred by the Worker: ack fast and
    // let the controller edit the interaction webhook when the action resolves.
    if (payload.source === "interaction") {
      void music.handle(payload).catch((e) => console.error("music handle failed:", e));
      return c.json({ ok: true });
    }
    // Panel controls wait for the result so the panel can report success.
    const result = await music.handle(payload);
    return c.json(result);
  });

  return app;
}
