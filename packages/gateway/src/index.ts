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
import { createOutbox } from "./outbox/index.js";
import { registerAutomations } from "./automations.js";

// 120 s (TTL KV côté Worker = 300 s) : reste sous le quota d'écritures KV du
// plan gratuit (1000/jour) tout en gardant le badge « Gateway » fiable.
const HEARTBEAT_INTERVAL_MS = 120_000;

const env = loadEnv();
const api = createWorkerApi(env);
// Reliable delivery (M05): opens the outbox only if GATEWAY_RELIABLE_TYPES lists
// a type (else a no-op → direct delivery unchanged). Two-step wiring: the outbox
// delivers via api.postReliableBatch; api routes reliable flows into the outbox.
const outbox = createOutbox(env, (events) => api.postReliableBatch(events));
api.attachOutbox(outbox);
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
const stats = registerStats(client, configCache, api);
registerAutomod(client, configCache, api);
registerXp(client, configCache, api);
registerVoiceXp(client, configCache, api);
registerStarboard(client, configCache, api);
registerTempVoice(client, configCache, api);
registerAutomations(client, configCache, outbox);
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
        delivery: outbox.metrics(),
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
  outbox.start(); // drains any events persisted from a previous run, then live traffic
  void heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
});

// --- Résilience session Discord --------------------------------------------
// Panne du 14/07 : la session WS est devenue zombie (transport vivant, plus
// aucun événement de dispatch) et discord.js n'a rien logué ni relancé →
// 3 jours sans logs vocaux/stats. Deux gardes ; dans les deux cas on SORT et
// systemd (Restart=always) relance avec une session fraîche (IDENTIFY).

// 1. Session invalidée : discord.js cesse définitivement de se reconnecter.
client.on(Events.Invalidated, () => {
  console.error("discord session invalidated — exiting so systemd restarts with a fresh session");
  shutdown("session-invalidated");
});

// 2. Watchdog zombie : un serveur avec des membres en ligne produit des paquets
// en continu (présences, messages, voice) ; 60 min de silence total = session
// morte même si le ping WS répond encore.
const DISPATCH_WATCHDOG_MS = 60 * 60_000;
let lastDispatchAt = Date.now();
client.on(Events.Raw, () => {
  lastDispatchAt = Date.now();
});
setInterval(() => {
  if (Date.now() - lastDispatchAt > DISPATCH_WATCHDOG_MS) {
    console.error(`no gateway dispatch for ${Math.round((Date.now() - lastDispatchAt) / 60000)} min — exiting (zombie session)`);
    shutdown("dispatch-watchdog");
  }
}, 60_000).unref();

// Traces de cycle de vie du shard : une prochaine coupure laissera un journal.
client.on(Events.ShardDisconnect, (event, id) => console.error(`shard ${id} disconnected (code ${event.code})`));
client.on(Events.ShardReconnecting, (id) => console.log(`shard ${id} reconnecting`));
client.on(Events.ShardResume, (id, replayed) => console.log(`shard ${id} resumed (${replayed} events replayed)`));
client.on(Events.ShardError, (error, id) => console.error(`shard ${id} error: ${error.message}`));

const server = serve({ fetch: createHttpApp(env, client, music).fetch, port: env.GATEWAY_PORT }, (info) => {
  console.log(`gateway http listening on :${info.port}`);
});

// Graceful stop: flush buffered stats, then stop the outbox dispatcher (waits
// for the in-flight batch, closes the DB — persisted events resume next boot).
// In-flight voice sessions are lost (accepted).
let shuttingDown = false;
function shutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`shutting down (${reason})`);
  server.close();
  void stats
    .flush()
    .catch(() => {})
    .then(() => outbox.stop())
    .catch(() => {})
    .finally(() => client.destroy().finally(() => process.exit(0)));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(signal));
}

await client.login(env.DISCORD_TOKEN);
