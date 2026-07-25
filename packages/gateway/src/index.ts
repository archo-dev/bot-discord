import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { serve } from "@hono/node-server";
import { loadEnv } from "./env.js";
import { createWorkerApi, type PresenceCounts } from "./worker-api.js";
import { createConfigCache } from "./config-cache.js";
import { initCapabilityReporter } from "./enforcement.js";
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
import { verifyDiscordApplicationId } from "./discord-identity.js";
import { SessionWatchdog, type WatchdogConfig } from "./session-watchdog.js";
import { observe } from "./observability.js";

// 120 s (TTL KV côté Worker = 300 s) : reste sous le quota d'écritures KV du
// plan gratuit (1000/jour) tout en gardant le badge « Gateway » fiable.
const HEARTBEAT_INTERVAL_MS = 120_000;

const env = loadEnv();
const api = createWorkerApi(env);
initCapabilityReporter(api);
// Reliable delivery (M05): opens the outbox only if GATEWAY_RELIABLE_TYPES lists
// a type (else a no-op → direct delivery unchanged). Two-step wiring: the outbox
// delivers via api.postReliableBatch; api routes reliable flows into the outbox.
const outbox = createOutbox(env, (events) => api.postReliableBatch(events));
api.attachOutbox(outbox);
const configCache = createConfigCache(api);

// Détection des sessions zombie (incident 07-23/24) : voir session-watchdog.ts.
const watchdogEnabled = env.GATEWAY_WATCHDOG_ENABLED === "true";
const watchdogConfig: WatchdogConfig = {
  readyGraceMs: env.GATEWAY_WATCHDOG_READY_GRACE_MS,
  applicativeSilenceMs: env.GATEWAY_WATCHDOG_SILENCE_MS,
  resumeWindowMs: env.GATEWAY_WATCHDOG_RESUME_WINDOW_MS,
  resumeLoopThreshold: env.GATEWAY_WATCHDOG_RESUME_LOOP,
  heartbeatStaleMs: env.GATEWAY_WATCHDOG_HEARTBEAT_STALE_MS,
};
const watchdog = new SessionWatchdog(watchdogConfig);

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

if (env.DISCORD_CLIENT_ID) {
  try {
    await verifyDiscordApplicationId(env.DISCORD_TOKEN, env.DISCORD_CLIENT_ID);
  } catch (err) {
    console.error(`discord application identity check failed: ${err instanceof Error ? err.message : "unknown error"}`);
    process.exit(1);
  }
}

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
const music = registerMusic(client, api, env.MUSIC_PRIMARY_SOURCE, env.INTERNAL_API_TOKEN);

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
  // Le tick du heartbeat prouve que la boucle d'événements vit et que le
  // transport WS répond — indépendamment de la joignabilité du Worker.
  watchdog.onHeartbeat(Date.now());
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

client.on(Events.ClientReady, () => {
  // ClientReady refires on a full re-IDENTIFY (fresh session) — reset the
  // watchdog baselines and the post-READY grace each time.
  watchdog.onReady(Date.now());
});

client.once(Events.ClientReady, (c) => {
  console.log(`gateway ready as ${c.user.tag} (${c.guilds.cache.size} guilds)`);
  outbox.start(); // drains any events persisted from a previous run, then live traffic
  void heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
});

// --- Résilience session Discord --------------------------------------------
// Panne du 14/07 puis 23/07 : la session WS devient zombie (transport vivant,
// heartbeat frais, mais plus aucun dispatch applicatif) et discord.js ne relance
// rien. Le 23/07 le shard RESUMEait « avec succès » toutes les 1-3 h sans jamais
// délivrer d'événements : l'ancien watchdog basé sur Events.Raw était réarmé par
// le dispatch RESUMED → jamais de restart. Voir session-watchdog.ts.
// Dans tous les cas on SORT proprement et systemd (Restart=always) relance avec
// une session fraîche (IDENTIFY).

// 1. Session invalidée : discord.js cesse définitivement de se reconnecter.
client.on(Events.Invalidated, () => {
  console.error("discord session invalidated — exiting so systemd restarts with a fresh session");
  shutdown("session-invalidated");
});

// 2. Watchdog zombie : suit le dernier dispatch APPLICATIF (READY/RESUMED exclus)
// et les RESUME successifs. N'agit que sur « transport frais + zéro dispatch
// applicatif + boucle de RESUME » — jamais sur une simple inactivité.
client.on(Events.Raw, (packet: unknown) => {
  const type = typeof packet === "object" && packet !== null && "t" in packet ? (packet as { t?: unknown }).t : undefined;
  watchdog.onDispatch(typeof type === "string" ? type : undefined, Date.now());
});
if (watchdogEnabled) {
  setInterval(() => {
    const decision = watchdog.evaluate(Date.now());
    if (decision.kind === "zombie") {
      observe("error", "gateway_zombie_suspected", {
        reason: decision.reason,
        resumesInWindow: decision.resumesInWindow,
        silenceSeconds: decision.applicativeSilenceMs / 1000,
      });
      observe("error", "gateway_restart_requested", { reason: decision.reason });
      console.error(
        `zombie session suspected (${decision.resumesInWindow} resumes, ${Math.round(decision.applicativeSilenceMs / 60000)} min without applicative dispatch) — exiting for a fresh IDENTIFY`,
      );
      shutdown("zombie-resume-loop");
    }
  }, 60_000).unref();
}

// Traces de cycle de vie du shard : une prochaine coupure laissera un journal.
client.on(Events.ShardDisconnect, (event, id) => console.error(`shard ${id} disconnected (code ${event.code})`));
client.on(Events.ShardReconnecting, (id) => console.log(`shard ${id} reconnecting`));
client.on(Events.ShardResume, (id, replayed) => {
  const now = Date.now();
  watchdog.onResume(now);
  observe("warn", "gateway_resume_detected", { resumesInWindow: watchdog.snapshot(now).resumesInWindow });
  console.log(`shard ${id} resumed (${replayed} events replayed)`);
});
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
