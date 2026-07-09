import { Hono } from "hono";
import type { Client } from "discord.js";
import type { GatewayEnv } from "./env.js";

/**
 * Gateway's own HTTP surface, reached only through the Cloudflare tunnel.
 * Bearer-guarded (GATEWAY_HTTP_TOKEN); the Worker will call it for the music
 * forward (M14) and panel-driven controls.
 */
export function createHttpApp(env: GatewayEnv, client: Client): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const auth = c.req.header("authorization");
    if (!auth || auth !== `Bearer ${env.GATEWAY_HTTP_TOKEN}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.get("/health", (c) =>
    c.json({
      ok: true,
      ready: client.isReady(),
      guildCount: client.guilds.cache.size,
      wsPing: client.ws.ping >= 0 ? client.ws.ping : null,
      uptimeSeconds: Math.floor(process.uptime()),
    }),
  );

  return app;
}
