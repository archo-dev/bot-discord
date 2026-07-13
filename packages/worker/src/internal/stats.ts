/** API interne — ingestion : heartbeat gateway, snapshots membres, activité salons, events. */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { incrementChannelActivity, insertGatewayEvent, upsertMemberSnapshot } from "../db/queries.js";

export const internalStatsRouter = new Hono<{ Bindings: Env }>();

const SNOWFLAKE = /^\d{5,20}$/;

const presenceCountsSchema = z.object({
  online: z.number().int().min(0),
  idle: z.number().int().min(0),
  dnd: z.number().int().min(0),
  offline: z.number().int().min(0),
});
const heartbeatSchema = z.object({
  guildCount: z.number().int().min(0),
  wsPing: z.number().nullable().optional(),
  // Per-guild presence counts (M18/M19). Empty/absent until the Presence intent
  // is enabled — the Stats page treats a missing guild as "intent off".
  presence: z.record(z.string(), presenceCountsSchema).optional(),
  // Optional during the rolling-deploy window: an older gateway continues to
  // publish a valid heartbeat while the Worker is upgraded first.
  runtime: z
    .object({
      version: z.string().min(1).max(40),
      uptimeSeconds: z.number().int().min(0).max(31_536_000),
      memoryRssMb: z.number().int().min(0).max(1_048_576),
      voiceLogQueueDepth: z.number().int().min(0).max(100_000),
      channelActivityQueueDepth: z.number().int().min(0).max(100_000),
      errorsSinceLastHeartbeat: z.number().int().min(0).max(1_000_000),
    })
    .optional(),
});

// Posted every 120 s by the gateway; the KV TTL (300 s) makes a silent gateway
// read as disconnected without any cleanup job (panel badge = key presence).
// Interval/TTL kept above 60 s to stay under the free KV write quota (1000/day).
internalStatsRouter.post("/internal/gateway/heartbeat", async (c) => {
  const parsed = heartbeatSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await c.env.KV.put(
    "gateway:status",
    JSON.stringify({
      at: Date.now(),
      guildCount: parsed.data.guildCount,
      wsPing: parsed.data.wsPing ?? null,
      presence: parsed.data.presence ?? null,
      runtime: parsed.data.runtime ?? null,
    }),
    { expirationTtl: 300 },
  );
  return c.json({ ok: true });
});

// --- Stats collection (M18) ------------------------------------------------

const memberSnapshotSchema = z.object({
  bucket: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/),
  total: z.number().int().min(0),
  humans: z.number().int().min(0),
  bots: z.number().int().min(0),
});

internalStatsRouter.post("/internal/guilds/:guildId/member-snapshots", async (c) => {
  const parsed = memberSnapshotSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await upsertMemberSnapshot(c.env.DB, c.req.param("guildId"), parsed.data);
  return c.json({ ok: true }, 201);
});

const channelActivitySchema = z.object({
  entries: z
    .array(
      z.object({
        channelId: z.string().regex(SNOWFLAKE),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        messageCount: z.number().int().min(0),
        voiceSeconds: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(200),
});

internalStatsRouter.post("/internal/guilds/:guildId/channel-activity", async (c) => {
  const parsed = channelActivitySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await incrementChannelActivity(c.env.DB, c.req.param("guildId"), parsed.data.entries);
  return c.json({ ok: true }, 201);
});

const eventSchema = z.object({
  eventType: z.enum(["member_join", "member_leave", "automod_action", "keyword_trigger"]),
  payload: z.record(z.string(), z.unknown()),
});

internalStatsRouter.post("/internal/guilds/:guildId/events", async (c) => {
  const parsed = eventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await insertGatewayEvent(c.env.DB, c.req.param("guildId"), parsed.data.eventType, JSON.stringify(parsed.data.payload));
  return c.json({ ok: true }, 201);
});
