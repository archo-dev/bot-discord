import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { serve } from "@hono/node-server";
import { loadEnv } from "./env.js";
import { createWorkerApi, type PresenceCounts } from "./worker-api.js";
import { createConfigCache } from "./config-cache.js";
import { createHttpApp } from "./http.js";
import { registerEvents } from "./events.js";
import { registerVoice } from "./voice.js";
import { registerStats } from "./stats.js";
import { registerAutomod } from "./automod.js";
import { registerXp } from "./xp.js";
import { registerVoiceXp } from "./voice-xp.js";
import { registerStarboard } from "./starboard.js";
import { registerMusic } from "./music.js";
import { registerGuildLifecycle } from "./guild-lifecycle.js";
import { registerTempVoice } from "./temp-voice.js";
import { logTelemetry, telemetryErrorCode } from "./telemetry.js";
import { buildGatewayRuntimeSnapshot } from "./health.js";

// 120 s (TTL KV côté Worker = 300 s) : reste sous le quota d'écritures KV du
// plan gratuit (1000/jour) tout en gardant le badge « Gateway » fiable.
const HEARTBEAT_INTERVAL_MS = 120_000;

const env = loadEnv();
const api = createWorkerApi(env);
const configCache = createConfigCache(api);

// GuildMembers + MessageContent are privileged: they must also be enabled in
// the Developer Portal (Bot → Server Members Intent + Message Content Intent),
// otherwise login fails with "Used disallowed intents".
// GuildVoiceStates (not privileged) is required for music (resolve the member's
// voice channel, detect empty channels). Partials.Message lets MessageDelete/Update
// fire for uncached messages.
// GuildPresences (privileged, M19) is gated behind PRESENCE_ENABLED so it's only
// requested once enabled in the portal — otherwise login crashes.
const presenceEnabled = env.PRESENCE_ENABLED === "true" || env.PRESENCE_ENABLED === "1";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    // Starboard (M23): reactions. Not privileged — no portal change needed.
    GatewayIntentBits.GuildMessageReactions,
    ...(presenceEnabled ? [GatewayIntentBits.GuildPresences] : []),
  ],
  // Partials.Reaction/Message let reactions fire on messages sent before the
  // gateway started (uncached); the handlers fetch them on demand.
  partials: [Partials.Message, Partials.Reaction],
});

registerGuildLifecycle(client, configCache, api, env.WORKER_ORIGIN);
registerEvents(client, configCache, api);
registerVoice(client, configCache, api);
const stats = registerStats(client, api);
registerAutomod(client, configCache, api);
registerXp(client, configCache, api);
registerVoiceXp(client, configCache, api);
registerStarboard(client, configCache, api);
registerTempVoice(client, configCache, api);
const music = registerMusic(client, api);

/** Per-guild presence counts from cache — empty until the Presence intent is on. */
function collectPresence(): Record<string, PresenceCounts> | undefined {
  const presence: Record<string, PresenceCounts> = {};
  for (const guild of client.guilds.cache.values()) {
    if (guild.presences.cache.size === 0) continue;
    const counts: PresenceCounts = { online: 0, idle: 0, dnd: 0, offline: 0 };
    for (const p of guild.presences.cache.values()) {
      if (p.status === "online") counts.online++;
      else if (p.status === "idle") counts.idle++;
      else if (p.status === "dnd") counts.dnd++;
      else counts.offline++;
    }
    presence[guild.id] = counts;
  }
  return Object.keys(presence).length > 0 ? presence : undefined;
}

async function heartbeat(): Promise<void> {
  const requestId = crypto.randomUUID();
  const health = api.getHealthSnapshot();
  try {
    await api.postHeartbeat({
      guildCount: client.guilds.cache.size,
      wsPing: client.ws.ping >= 0 ? client.ws.ping : null,
      presence: collectPresence(),
      runtime: buildGatewayRuntimeSnapshot({
        version: process.env.GATEWAY_VERSION ?? process.env.GATEWAY_BUILD_VERSION ?? process.env.npm_package_version,
        uptimeSeconds: process.uptime(),
        memoryRssBytes: process.memoryUsage().rss,
        voiceLogQueueDepth: health.voiceLogQueueDepth,
        channelActivityQueueDepth: stats.pendingEntries(),
        errorsSinceLastHeartbeat: health.errorsSinceLastHeartbeat,
      }),
    });
    api.acknowledgeHeartbeat();
  } catch (err) {
    logTelemetry("error", {
      requestId,
      module: "gateway",
      operation: "heartbeat",
      outcome: "error",
      errorCode: telemetryErrorCode(err),
      source: "gateway",
    });
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`gateway ready as ${c.user.tag} (${c.guilds.cache.size} guilds)`);
  void heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
});

const server = serve({ fetch: createHttpApp(env, client, music).fetch, port: env.GATEWAY_PORT }, (info) => {
  console.log(`gateway http listening on :${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close();
    // Flush buffered stats before exit; in-flight voice sessions are lost (accepted).
    void stats
      .flush()
      .catch(() => {})
      .finally(() => client.destroy().finally(() => process.exit(0)));
  });
}

await client.login(env.DISCORD_TOKEN);
