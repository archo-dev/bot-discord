import type { GuildGatewayConfig, WorkerApi } from "./worker-api.js";

const TTL_MS = 60_000;
// A null (guild unknown to the Worker) is cached briefly so a burst of events
// doesn't hammer the Worker, but not for the full minute: a freshly-added guild
// must recover quickly on the next event.
const NULL_TTL_MS = 5_000;

/**
 * Borne dure (timer JS, PAS le timeout fetch/undici) sur une requête de config
 * coalescée. Incident 07-25 : un fetch interne s'est figé sans jamais se régler
 * — l'AbortSignal.timeout d'undici n'a pas abort (socket keep-alive mort sur un
 * process long). La promesse stockée dans `inFlight` restait pendante à vie, donc
 * chaque get() suivant réutilisait cette promesse morte → blackout permanent des
 * logs vocaux (embeds + persistance D1) jusqu'au redémarrage. Ce timer garantit
 * qu'une requête bloquée REJETTE et libère `inFlight`, transformant un blackout
 * permanent en échec temporaire auto-récupérable. Choisi < au timeout transport
 * (`call()` = 10 s) pour que le cache se dégage AVANT, sans dépendre d'undici.
 */
const REQUEST_TIMEOUT_MS = 8_000;

interface CacheEntry {
  value: GuildGatewayConfig | null;
  expiresAt: number;
}

/** Rejet distinguable : le fetch de config a dépassé la borne dure du cache. */
export class ConfigFetchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`config fetch timed out after ${timeoutMs}ms`);
    this.name = "ConfigFetchTimeoutError";
  }
}

/**
 * Per-guild config cache (60 s): panel edits land without restarting the
 * gateway, while event handlers (M11+) avoid one Worker round-trip per event.
 *
 * M04 — request coalescing: on a cold cache, N concurrent get() calls for the
 * same guild (a channel emptying fires many events at once) share a SINGLE
 * Worker request instead of triggering N identical /internal/config calls.
 *
 * Auto-guérison (07-26) : chaque requête coalescée est bornée par un timer JS
 * dur. Une requête qui ne se règle jamais (fetch figé) rejette au bout de
 * `requestTimeoutMs`, libère `inFlight` et n'est PAS mise en cache → le prochain
 * get() relance une vraie requête. Impossible d'empoisonner le cache à vie.
 */
export function createConfigCache(api: WorkerApi, options: { requestTimeoutMs?: number } = {}) {
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<GuildGatewayConfig | null>>();

  async function load(guildId: string): Promise<GuildGatewayConfig | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ConfigFetchTimeoutError(requestTimeoutMs)), requestTimeoutMs);
    });
    // La vraie requête. `catch` no-op indispensable : si le timer gagne la course,
    // ce fetch reste pendant (socket mort) et finira par rejeter — sans cette garde
    // ce serait un unhandledRejection, car plus personne ne l'attend.
    const fetchPromise = api.getGuildConfig(guildId);
    fetchPromise.catch(() => {});
    try {
      const value = await Promise.race([fetchPromise, timeout]);
      // Succès seulement : un échec/timeout n'est jamais mis en cache.
      entries.set(guildId, { value, expiresAt: Date.now() + (value === null ? NULL_TTL_MS : TTL_MS) });
      return value;
    } finally {
      // Toujours : on nettoie le timer (pas de fuite) et on libère `inFlight`
      // (pas de promesse morte réutilisée), succès comme échec.
      clearTimeout(timer);
      inFlight.delete(guildId);
    }
  }

  return {
    async get(guildId: string): Promise<GuildGatewayConfig | null> {
      const hit = entries.get(guildId);
      if (hit && hit.expiresAt > Date.now()) return hit.value;

      // Coalesce concurrent misses onto the pending (already time-bounded) request.
      const pending = inFlight.get(guildId);
      if (pending) return pending;

      const request = load(guildId);
      inFlight.set(guildId, request);
      return request;
    },
    invalidate(guildId: string): void {
      entries.delete(guildId);
      inFlight.delete(guildId);
    },
  };
}

export type ConfigCache = ReturnType<typeof createConfigCache>;
