/** M05 — reliable delivery ingestion: idempotent, at-least-once batch endpoint. */

import { Hono } from "hono";
import {
  RELIABLE_EVENT_MODULE,
  reliableBatchRequestSchema,
  validateReliableEnvelope,
  type ReliableAck,
  type ReliableAckStatus,
} from "@bot/shared";
import type { Env } from "../env.js";
import { applyReliableEvent, findProcessedEvents, isGuildModuleEnabled } from "../db/queries.js";

export const internalEventsRouter = new Hono<{ Bindings: Env }>();

/**
 * Accepts a batch of versioned event envelopes from the gateway outbox and
 * applies each at-least-once with dedup. Per-event ACK lets the gateway remove
 * delivered/duplicate/skipped events and retry only the transient ones. The
 * Worker stays the sole D1 writer; auth is the signed M02 path (see routes.ts).
 */
internalEventsRouter.post("/internal/events/batch", async (c) => {
  const parsed = reliableBatchRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  // Dedup fast path: one lookup for the whole batch.
  const processed = await findProcessedEvents(
    c.env.DB,
    parsed.data.events.map((e) => e.eventId),
  );

  // Memoize module-enabled per (guild, module) within the batch.
  const moduleCache = new Map<string, boolean>();
  const moduleEnabled = async (guildId: string, moduleId: string): Promise<boolean> => {
    const key = `${guildId}:${moduleId}`;
    const hit = moduleCache.get(key);
    if (hit !== undefined) return hit;
    const enabled = await isGuildModuleEnabled(c.env.DB, guildId, moduleId as never);
    moduleCache.set(key, enabled);
    return enabled;
  };

  const now = Date.now();
  const results: ReliableAck[] = [];
  for (const raw of parsed.data.events) {
    let status: ReliableAckStatus;
    if (processed.has(raw.eventId)) {
      status = "duplicate";
    } else {
      const validated = validateReliableEnvelope(raw);
      if (!validated.ok) {
        // Poison: a permanently invalid payload is dead-lettered, never retried.
        status = "invalid";
      } else if (!(await moduleEnabled(validated.envelope.guildId, RELIABLE_EVENT_MODULE[validated.envelope.type]))) {
        status = "skipped";
      } else {
        try {
          await applyReliableEvent(c.env.DB, validated.envelope, now);
          status = "accepted";
        } catch {
          // Atomic rollback guarantees no partial apply; a concurrent duplicate
          // or transient D1 error → retry (next attempt hits the dedup fast path).
          status = "retry";
        }
      }
    }
    results.push({ eventId: raw.eventId, status });
  }

  return c.json({ results });
});
