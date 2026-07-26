/**
 * Observabilité bornée du gateway (incident logs vocaux 07-23/24).
 *
 * Schéma FERMÉ, comme la télémétrie partagée : jamais de contenu utilisateur, de
 * pseudo, de nom de salon, d'URL, de token ni de message d'erreur brut. Seuls
 * des identifiants d'événement allowlistés, une clé de guilde pseudonymisée
 * (non réversible) et des agrégats/énumérations bornés sont émis.
 */

import { createHash } from "node:crypto";
import type { VoiceLogAction } from "@bot/shared";

export type GatewayObservabilityEvent =
  // Flux vocal (voice.ts)
  | "voice_event_received"
  | "voice_event_persisted"
  | "voice_log_sent"
  | "voice_log_skipped"
  | "voice_log_failed"
  // Cycle de session (index.ts / session-watchdog.ts)
  | "gateway_resume_detected"
  | "gateway_zombie_suspected"
  | "gateway_restart_requested";

/** Raisons bornées (énumération fermée — jamais de texte libre). */
export type GatewayObservabilityReason =
  | "toggle_off"
  | "no_channel"
  | "channel_missing"
  | "channel_not_text"
  | "module_disabled"
  | "config_missing"
  | "config_timeout"
  | "persist_error"
  | "send_error"
  | "resume_loop";

type ObservabilityLevel = "info" | "warn" | "error";

export interface GatewayObservabilityFields {
  /** Pseudonymisé avant émission ; l'ID brut ne quitte jamais l'appelant. */
  guildId?: string;
  action?: VoiceLogAction;
  reason?: GatewayObservabilityReason;
  resumesInWindow?: number;
  silenceSeconds?: number;
}

/**
 * Pseudonyme de guilde non réversible pour corréler des lignes de journal sans
 * exposer l'ID. SHA-256 tronqué : aucun secret dans le journal, non inversible.
 */
export function guildKey(guildId: string): string {
  return createHash("sha256").update(`gw:${guildId}`).digest("hex").slice(0, 12);
}

/** Émet une ligne JSON bornée. */
export function observe(level: ObservabilityLevel, event: GatewayObservabilityEvent, fields: GatewayObservabilityFields = {}): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    source: "gateway",
    event,
    ...(fields.guildId ? { guildKey: guildKey(fields.guildId) } : {}),
    ...(fields.action ? { action: fields.action } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ...(fields.resumesInWindow !== undefined ? { resumesInWindow: fields.resumesInWindow } : {}),
    ...(fields.silenceSeconds !== undefined ? { silenceSeconds: Math.max(0, Math.round(fields.silenceSeconds)) } : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
