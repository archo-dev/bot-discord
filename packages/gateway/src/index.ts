import { Client, Events, GatewayIntentBits } from "discord.js";
import { serve } from "@hono/node-server";
import { loadEnv } from "./env.js";
import { createWorkerApi } from "./worker-api.js";
import { createConfigCache } from "./config-cache.js";
import { createHttpApp } from "./http.js";

const HEARTBEAT_INTERVAL_MS = 60_000;

const env = loadEnv();
const api = createWorkerApi(env);
export const configCache = createConfigCache(api);

// M10 scaffold: Guilds only. M11 (welcome/logs) adds GuildMembers + GuildMessages
// — both must also be enabled in the Developer Portal (privileged intents).
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function heartbeat(): Promise<void> {
  try {
    await api.postHeartbeat({
      guildCount: client.guilds.cache.size,
      wsPing: client.ws.ping >= 0 ? client.ws.ping : null,
    });
  } catch (err) {
    console.error("heartbeat failed:", err instanceof Error ? err.message : err);
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`gateway ready as ${c.user.tag} (${c.guilds.cache.size} guilds)`);
  void heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
});

const server = serve({ fetch: createHttpApp(env, client).fetch, port: env.GATEWAY_PORT }, (info) => {
  console.log(`gateway http listening on :${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close();
    void client.destroy().finally(() => process.exit(0));
  });
}

await client.login(env.DISCORD_TOKEN);
