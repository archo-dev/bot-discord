/**
 * Reliable delivery contract (M05) — shared frontier between Gateway (producer,
 * local outbox) and Worker (consumer, idempotent applier, sole D1 writer).
 *
 * Privacy: envelopes carry ONLY the minimal fields already needed to apply the
 * effect. Never add token, secret, cookie, auth header, IP, raw error, attachment,
 * transcript, raw HTTP body, token or secret to a payload here. M10 automation
 * events may contain bounded message content only when a guild has subscribed
 * to the message_create trigger; it is purged with the queue retention.
 */

import { z } from "zod";
import type { ModuleId } from "./modules.js";
import { AUTOMATION_MAX_DEPTH, automationEventContextSchema } from "./automation.js";

export const RELIABLE_DELIVERY_SCHEMA_VERSION = 1 as const;

/** Max events per POST /internal/events/batch (stays far under the 512 KiB internal body limit). */
export const RELIABLE_BATCH_MAX = 100;

/**
 * Event types delivered at-least-once with Worker-side dedup. Only pure-D1-effect
 * flows are here: their whole effect can be applied atomically with the dedup
 * insert. Side-effect flows (xp/automod/starboard) stay on the direct path.
 */
export const RELIABLE_EVENT_TYPES = ["voice_log", "channel_activity", "member_snapshot", "gateway_event", "automation_event"] as const;
export type ReliableEventType = (typeof RELIABLE_EVENT_TYPES)[number];

const SNOWFLAKE = /^\d{5,20}$/;

// --- Per-type payload schemas (mirror the existing direct endpoints) ---------

export const voiceLogPayloadSchema = z.object({
  userId: z.string().regex(SNOWFLAKE),
  userTag: z.string().max(100).nullable(),
  action: z.enum(["join", "leave", "move", "mute", "unmute", "deafen", "undeafen"]),
  channelId: z.string().regex(SNOWFLAKE).nullable(),
  fromChannelId: z.string().regex(SNOWFLAKE).nullable(),
});

export const channelActivityPayloadSchema = z.object({
  channelId: z.string().regex(SNOWFLAKE),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  messageCount: z.number().int().min(0).max(1_000_000),
  voiceSeconds: z.number().int().min(0).max(100_000_000),
});

export const memberSnapshotPayloadSchema = z.object({
  bucket: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/),
  total: z.number().int().min(0),
  humans: z.number().int().min(0),
  bots: z.number().int().min(0),
});

export const gatewayEventPayloadSchema = z.object({
  eventType: z.enum(["member_join", "member_leave", "automod_action", "keyword_trigger"]),
  // Bounded, content-free: user/target ids at most. No message content.
  payload: z.record(z.string(), z.unknown()),
});

export const automationEventPayloadSchema = z.object({
  context: automationEventContextSchema,
  correlationId: z.string().uuid(),
  rootEventId: z.string().uuid(),
  depth: z.number().int().min(0).max(AUTOMATION_MAX_DEPTH),
}).superRefine((value, ctx) => {
  if (value.context.event.depth !== value.depth) ctx.addIssue({ code: "custom", path: ["context", "event", "depth"], message: "depth mismatch" });
});

export const RELIABLE_PAYLOAD_SCHEMAS = {
  voice_log: voiceLogPayloadSchema,
  channel_activity: channelActivityPayloadSchema,
  member_snapshot: memberSnapshotPayloadSchema,
  gateway_event: gatewayEventPayloadSchema,
  automation_event: automationEventPayloadSchema,
} satisfies Record<ReliableEventType, z.ZodType>;

export type VoiceLogPayload = z.infer<typeof voiceLogPayloadSchema>;
export type ChannelActivityPayload = z.infer<typeof channelActivityPayloadSchema>;
export type MemberSnapshotPayload = z.infer<typeof memberSnapshotPayloadSchema>;
export type GatewayEventPayload = z.infer<typeof gatewayEventPayloadSchema>;
export type AutomationEventPayload = z.infer<typeof automationEventPayloadSchema>;

// --- Governance / routing metadata per type ---------------------------------

/** M03 module gating the effect (checked Worker-side before applying). */
export const RELIABLE_EVENT_MODULE = {
  voice_log: "voice_logs",
  channel_activity: "stats",
  member_snapshot: "stats",
  gateway_event: "stats",
  automation_event: "automations",
} satisfies Record<ReliableEventType, ModuleId>;

/** 0 = normal (drained first), 1 = low (droppable under backpressure). */
export const RELIABLE_EVENT_PRIORITY = {
  voice_log: 0,
  gateway_event: 0,
  channel_activity: 1,
  member_snapshot: 1,
  automation_event: 0,
} satisfies Record<ReliableEventType, 0 | 1>;

/** Ordering partition. All reliable flows are per-guild; no cross-guild order. */
export function reliablePartitionKey(guildId: string): string {
  return `g:${guildId}`;
}

// --- Envelope ----------------------------------------------------------------

export const reliableEnvelopeSchema = z.object({
  schemaVersion: z.literal(RELIABLE_DELIVERY_SCHEMA_VERSION),
  eventId: z.string().uuid(),
  type: z.enum(RELIABLE_EVENT_TYPES),
  guildId: z.string().regex(SNOWFLAKE),
  partitionKey: z.string().min(1).max(64),
  priority: z.union([z.literal(0), z.literal(1)]),
  occurredAt: z.number().int().min(0),
  // Validated precisely against the per-type schema by validateReliableEnvelope.
  payload: z.unknown(),
});

type EnvelopeFor<T extends ReliableEventType> = {
  schemaVersion: typeof RELIABLE_DELIVERY_SCHEMA_VERSION;
  eventId: string;
  type: T;
  guildId: string;
  partitionKey: string;
  priority: 0 | 1;
  occurredAt: number;
  payload: z.infer<(typeof RELIABLE_PAYLOAD_SCHEMAS)[T]>;
};

/** Discriminated union on `type` — `switch (env.type)` narrows `env.payload`. */
export type ReliableEnvelope = { [K in ReliableEventType]: EnvelopeFor<K> }[ReliableEventType];

export type ReliableEnvelopeValidation =
  | { ok: true; envelope: ReliableEnvelope }
  | { ok: false; code: "invalid_envelope" | "unsupported_version" | "invalid_payload" };

/** Full validation: envelope shape + per-type payload. Used Worker-side and Gateway-side. */
export function validateReliableEnvelope(value: unknown): ReliableEnvelopeValidation {
  const outer = reliableEnvelopeSchema.safeParse(value);
  if (!outer.success) {
    const versioned = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (versioned !== undefined && versioned !== RELIABLE_DELIVERY_SCHEMA_VERSION) {
      return { ok: false, code: "unsupported_version" };
    }
    return { ok: false, code: "invalid_envelope" };
  }
  const payload = RELIABLE_PAYLOAD_SCHEMAS[outer.data.type].safeParse(outer.data.payload);
  if (!payload.success) return { ok: false, code: "invalid_payload" };
  return { ok: true, envelope: { ...outer.data, payload: payload.data } as ReliableEnvelope };
}

// --- Batch request / ACK -----------------------------------------------------

export const reliableBatchRequestSchema = z.object({
  events: z.array(reliableEnvelopeSchema).min(1).max(RELIABLE_BATCH_MAX),
});

/**
 * Per-event ACK status:
 * - accepted / duplicate → delivered, remove from outbox;
 * - skipped → module disabled, remove from outbox (obsolete);
 * - invalid → permanently rejected (poison), move to dead-letter, do NOT retry;
 * - retry → transient, keep and retry with backoff.
 */
export const RELIABLE_ACK_STATUSES = ["accepted", "duplicate", "skipped", "invalid", "retry"] as const;
export type ReliableAckStatus = (typeof RELIABLE_ACK_STATUSES)[number];

export interface ReliableAck {
  eventId: string;
  status: ReliableAckStatus;
}

export interface ReliableBatchResponse {
  results: ReliableAck[];
}

/** True when the ACK means the event can be removed from the local outbox. */
export function ackIsTerminal(status: ReliableAckStatus): boolean {
  return status === "accepted" || status === "duplicate" || status === "skipped";
}
