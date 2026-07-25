/*
 * Choke C — enforcement des plans côté Gateway (temps réel). Utilise la MÊME
 * policy pure @bot/shared (`evaluateCapability`) que le Worker : parité garantie.
 *
 * En shadow : on calcule la décision et on l'agrège (dims bornées, no PII), sans
 * jamais bloquer. En enforce : la décision est renvoyée à l'appelant (à lui de
 * l'appliquer). Absent/"off" : no-op total. Singleton process : `init` au boot.
 */

import {
  evaluateCapability,
  type CapabilityDecision,
  type CapabilityId,
  type CapabilityMetricBatchItem,
} from "@bot/shared";
import type { GuildGatewayConfig } from "./worker-api.js";
import type { WorkerApi } from "./worker-api.js";

type MetricKey = string;

interface Reporter {
  observe(config: GuildGatewayConfig | null, capability: CapabilityId, usage?: number | null): CapabilityDecision;
  flush(): Promise<void>;
}

let reporter: Reporter | null = null;

/** Décision « autorisée » neutre (mode off / reporter absent). */
function allow(capability: CapabilityId): CapabilityDecision {
  return {
    allowed: true, capability, requiredPlan: "free", effectivePlan: "free",
    reason: "allowed_by_plan", quota: null, usage: null, enforcementMode: "off", wouldBlock: false,
  };
}

/** Initialise le reporter (buffer + flush périodique). Idempotent. */
export function initCapabilityReporter(api: WorkerApi, flushMs = 10_000): void {
  if (reporter) return;
  const buffer = new Map<MetricKey, CapabilityMetricBatchItem>();

  const flush = async (): Promise<void> => {
    if (buffer.size === 0) return;
    const items = [...buffer.values()];
    buffer.clear();
    await api.postCapabilityMetrics(items);
  };

  reporter = {
    observe(config, capability, usage) {
      const mode = config?.enforcementMode;
      if (!config || !mode || mode === "off") return allow(capability);
      const effectivePlan = config.plan?.id ?? "free";
      const decision = evaluateCapability({ capability, effectivePlan, mode, usage });
      const key = `${decision.capability}|${decision.effectivePlan}|${decision.requiredPlan}|${decision.reason}|${decision.wouldBlock ? "would_block" : "allowed"}`;
      const existing = buffer.get(key);
      if (existing) existing.count += 1;
      else buffer.set(key, {
        surface: "gateway",
        capability: decision.capability,
        effectivePlan: decision.effectivePlan,
        requiredPlan: decision.requiredPlan,
        reason: decision.reason,
        decision: decision.wouldBlock ? "would_block" : "allowed",
        count: 1,
      });
      // Garde-fou anti-croissance : flush immédiat au-delà d'un seuil borné.
      if (buffer.size >= 1000) void flush();
      return decision;
    },
    flush,
  };

  setInterval(() => void reporter?.flush(), flushMs).unref?.();
}

/**
 * Observe (et, en enforce, décide) une capability côté Gateway. No-op sûr si le
 * reporter n'est pas initialisé ou si le mode est off. Retourne toujours une
 * décision exploitable (`allowed=true` en shadow/off).
 */
export function observeGatewayCapability(
  config: GuildGatewayConfig | null,
  capability: CapabilityId,
  usage?: number | null,
): CapabilityDecision {
  return reporter ? reporter.observe(config, capability, usage) : allow(capability);
}

/** Flush manuel (tests / arrêt propre). */
export async function flushCapabilityMetrics(): Promise<void> {
  await reporter?.flush();
}

/** Réinitialise le singleton (tests uniquement). */
export function __resetCapabilityReporter(): void {
  reporter = null;
}
