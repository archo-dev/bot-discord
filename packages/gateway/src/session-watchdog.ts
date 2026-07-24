/**
 * Détection des sessions Discord « zombie » (incident 07-23/24).
 *
 * Mode de panne visé : le shard se reconnecte et fait un RESUME « avec succès »
 * toutes les 1-3 h, mais la session resumée ne délivre plus AUCUN dispatch
 * applicatif réel (voiceStateUpdate, messageCreate…). Le transport WS vit
 * (heartbeat frais, /status vert), `Events.Invalidated` ne se déclenche jamais,
 * et l'ancien watchdog — qui réarmait son minuteur sur `Events.Raw` — était
 * remis à zéro par le dispatch `RESUMED` de chaque RESUME → jamais de restart.
 *
 * Ce watchdog sépare trois signaux et n'agit QUE sur la combinaison trompeuse
 * « transport frais + zéro dispatch applicatif + boucle de RESUME » :
 *   - transport/boucle d'événements vivante (heartbeat) ;
 *   - dernier dispatch applicatif réel (hors READY/RESUMED) ;
 *   - RESUME successifs dans une fenêtre glissante.
 *
 * Il ne redémarre PAS un bot simplement inactif (transport frais, silence, mais
 * aucun RESUME) : un serveur calme est un état légitime. La preuve d'un zombie
 * est la boucle de RESUME sans backfill, pas le silence seul.
 */

/** Dispatches de contrôle de session : ne comptent PAS comme activité métier. */
const SESSION_CONTROL_DISPATCHES = new Set(["READY", "RESUMED"]);

export interface WatchdogConfig {
  /** Délai de grâce après un READY avant toute évaluation (démarrage/reconnexion complète). */
  readyGraceMs: number;
  /** Silence applicatif maximal toléré quand le transport est frais. */
  applicativeSilenceMs: number;
  /** Fenêtre glissante de comptage des RESUME. */
  resumeWindowMs: number;
  /** Nombre de RESUME dans la fenêtre (sans dispatch applicatif) valant zombie. */
  resumeLoopThreshold: number;
  /** Au-delà, le transport (heartbeat) est considéré mort → géré par la reconnexion discord.js. */
  heartbeatStaleMs: number;
}

/** Valeurs par défaut, calibrées sur l'incident (RESUME ~toutes les 1-3 h). */
export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  readyGraceMs: 120_000, // 2 min
  applicativeSilenceMs: 15 * 60_000, // 15 min
  resumeWindowMs: 3 * 60 * 60_000, // 3 h
  resumeLoopThreshold: 2,
  heartbeatStaleMs: 5 * 60_000, // 5 min
};

export type WatchdogDecision =
  | { kind: "starting" } // dans le délai de grâce post-READY
  | { kind: "transport_down" } // heartbeat périmé → laisser discord.js / Invalidated agir
  | { kind: "healthy" } // dispatch applicatif récent
  | { kind: "quiet" } // silence légitime : transport frais, aucune boucle de RESUME
  | {
      kind: "zombie";
      reason: "resume_loop";
      resumesInWindow: number;
      applicativeSilenceMs: number;
    };

export interface WatchdogSnapshot {
  resumesInWindow: number;
  applicativeSilenceMs: number | null;
  sinceLastMessageMs: number | null;
  sinceLastVoiceMs: number | null;
  transportFresh: boolean;
}

/**
 * Machine à états pure (horloge injectée) — testable sans discord.js ni timers.
 * `evaluate()` est idempotente ; une fois « zombie » verrouillé, elle ne le
 * redemande plus (une seule requête de restart par process → pas de rafale).
 */
export class SessionWatchdog {
  private readonly config: WatchdogConfig;
  private lastReadyAt: number | null = null;
  private lastHeartbeatAt: number | null = null;
  private lastApplicativeDispatchAt: number | null = null;
  private lastMessageCreateAt: number | null = null;
  private lastVoiceStateUpdateAt: number | null = null;
  private resumes: number[] = [];
  private restartLatched = false;

  constructor(config: WatchdogConfig = DEFAULT_WATCHDOG_CONFIG) {
    this.config = config;
  }

  /** READY = session fraîche (IDENTIFY). Réinitialise les compteurs et la grâce. */
  onReady(now: number): void {
    this.lastReadyAt = now;
    this.lastApplicativeDispatchAt = now;
    this.resumes = [];
    this.restartLatched = false;
  }

  /** Heartbeat/tick de la boucle d'événements : preuve que le transport est vivant. */
  onHeartbeat(now: number): void {
    this.lastHeartbeatAt = now;
  }

  /** RESUME du shard : accumulé dans la fenêtre glissante. */
  onResume(now: number): void {
    this.resumes.push(now);
    this.pruneResumes(now);
  }

  /**
   * Dispatch reçu (`packet.t`). Les dispatches de contrôle (READY/RESUMED) sont
   * ignorés ; tout dispatch applicatif réel prouve que la session délivre → on
   * purge les RESUME accumulés et on rafraîchit l'horloge d'activité.
   */
  onDispatch(type: string | undefined, now: number): void {
    if (!type || SESSION_CONTROL_DISPATCHES.has(type)) return;
    this.lastApplicativeDispatchAt = now;
    this.resumes = [];
    if (type === "MESSAGE_CREATE") this.lastMessageCreateAt = now;
    else if (type === "VOICE_STATE_UPDATE") this.lastVoiceStateUpdateAt = now;
  }

  evaluate(now: number): WatchdogDecision {
    if (this.restartLatched) return { kind: "healthy" };
    if (this.lastReadyAt === null || now - this.lastReadyAt < this.config.readyGraceMs) {
      return { kind: "starting" };
    }
    const transportFresh = this.lastHeartbeatAt !== null && now - this.lastHeartbeatAt <= this.config.heartbeatStaleMs;
    if (!transportFresh) return { kind: "transport_down" };

    const silence = now - (this.lastApplicativeDispatchAt ?? this.lastReadyAt);
    if (silence < this.config.applicativeSilenceMs) return { kind: "healthy" };

    this.pruneResumes(now);
    if (this.resumes.length >= this.config.resumeLoopThreshold) {
      this.restartLatched = true;
      return { kind: "zombie", reason: "resume_loop", resumesInWindow: this.resumes.length, applicativeSilenceMs: silence };
    }
    // Transport frais + silence, mais pas de boucle de RESUME : inactivité légitime.
    return { kind: "quiet" };
  }

  snapshot(now: number): WatchdogSnapshot {
    this.pruneResumes(now);
    return {
      resumesInWindow: this.resumes.length,
      applicativeSilenceMs: this.lastApplicativeDispatchAt === null ? null : now - this.lastApplicativeDispatchAt,
      sinceLastMessageMs: this.lastMessageCreateAt === null ? null : now - this.lastMessageCreateAt,
      sinceLastVoiceMs: this.lastVoiceStateUpdateAt === null ? null : now - this.lastVoiceStateUpdateAt,
      transportFresh: this.lastHeartbeatAt !== null && now - this.lastHeartbeatAt <= this.config.heartbeatStaleMs,
    };
  }

  private pruneResumes(now: number): void {
    const cutoff = now - this.config.resumeWindowMs;
    if (this.resumes.length > 0 && this.resumes[0]! <= cutoff) {
      this.resumes = this.resumes.filter((at) => at > cutoff);
    }
  }
}
