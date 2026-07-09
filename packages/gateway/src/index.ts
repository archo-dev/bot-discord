import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { serve } from "@hono/node-server";
import { loadEnv } from "./env.js";
import { createWorkerApi } from "./worker-api.js";
import { createConfigCache } from "./config-cache.js";
import { createHttpApp } from "./http.js";
import { registerEvents } from "./events.js";
import { registerAutomod } from "./automod.js";
import { registerXp } from "./xp.js";

const HEARTBEAT_INTERVAL_MS = 60_000;

const env = loadEnv();
const api = createWorkerApi(env);
const configCache = createConfigCache(api);

// GuildMembers + MessageContent are privileged: they must also be enabled in
// the Developer Portal (Bot → Server Members Intent + Message Content Intent),
// otherwise login fails with "Used disallowed intents".
// Partials.Message lets MessageDelete/Update fire for uncached messages.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message],
});

registerEvents(client, configCache, api);
registerAutomod(client, configCache, api);
registerXp(client, configCache, api);

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
