import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetCapabilityReporter,
  flushCapabilityMetrics,
  initCapabilityReporter,
  observeGatewayCapability,
} from "../src/enforcement.js";
import type { CapabilityMetricBatchItem } from "@bot/shared";
import type { GuildGatewayConfig, WorkerApi } from "../src/worker-api.js";

/*
 * Choke C — reporter shadow côté Gateway. On vérifie que le flush :
 *  - livre le batch quand le Worker répond 2xx (buffer vidé) ;
 *  - NE perd PAS le batch en silence sur échec (404/non-2xx) : il le ré-injecte
 *    pour un retry borné, jusqu'à livraison, sans double-comptage à la livraison.
 */

// Config en mode shadow (sinon observe court-circuite sans rien enregistrer).
const shadowConfig = { enforcementMode: "shadow", plan: { id: "free" } } as unknown as GuildGatewayConfig;

/** Stub WorkerApi n'exposant que postCapabilityMetrics, avec succès pilotable. */
function stubApi(deliver: () => boolean): {
  api: WorkerApi;
  batches: () => CapabilityMetricBatchItem[][];
} {
  const post = vi.fn(async (items: CapabilityMetricBatchItem[]) => deliver());
  const api = { postCapabilityMetrics: post } as unknown as WorkerApi;
  return { api, batches: () => post.mock.calls.map((c) => c[0] as CapabilityMetricBatchItem[]) };
}

afterEach(() => __resetCapabilityReporter());

describe("gateway capability reporter — flush delivery", () => {
  it("delivers the batch on 2xx and empties the buffer", async () => {
    // flushMs énorme : l'intervalle ne se déclenche pas seul, on flush à la main.
    const { api, batches } = stubApi(() => true);
    initCapabilityReporter(api, 10_000_000);

    observeGatewayCapability(shadowConfig, "stats.use");
    observeGatewayCapability(shadowConfig, "stats.use");
    await flushCapabilityMetrics();

    expect(batches()).toHaveLength(1);
    expect(batches()[0]).toEqual([
      {
        surface: "gateway",
        capability: "stats.use",
        effectivePlan: "free",
        requiredPlan: "free",
        reason: "allowed_by_plan",
        decision: "allowed",
        count: 2,
      },
    ]);

    // Buffer vidé après livraison : un second flush ne rappelle pas le Worker.
    await flushCapabilityMetrics();
    expect(batches()).toHaveLength(1);
  });

  it("re-queues the batch on delivery failure and never loses it, without double delivery", async () => {
    let ok = false; // 1er flush échoue (ex. 404), puis succès.
    const { api, batches } = stubApi(() => ok);
    initCapabilityReporter(api, 10_000_000);

    observeGatewayCapability(shadowConfig, "stats.use");
    await flushCapabilityMetrics(); // échec → ré-injection
    expect(batches()).toHaveLength(1);

    // Le batch n'est pas perdu : le tick suivant le renvoie avec le même count.
    ok = true;
    await flushCapabilityMetrics(); // succès
    expect(batches()).toHaveLength(2);
    expect(batches()[1]).toEqual([
      {
        surface: "gateway",
        capability: "stats.use",
        effectivePlan: "free",
        requiredPlan: "free",
        reason: "allowed_by_plan",
        decision: "allowed",
        count: 1,
      },
    ]);

    // Livré une fois : plus rien à renvoyer (pas de duplication incontrôlée).
    await flushCapabilityMetrics();
    expect(batches()).toHaveLength(2);
  });

  it("does not record anything when enforcement mode is off/absent", async () => {
    const { api, batches } = stubApi(() => true);
    initCapabilityReporter(api, 10_000_000);

    observeGatewayCapability({ plan: { id: "free" } } as unknown as GuildGatewayConfig, "stats.use");
    observeGatewayCapability(null, "stats.use");
    await flushCapabilityMetrics();

    expect(batches()).toHaveLength(0);
  });
});
