/** Studio audit writer (M14). Every sensitive operator mutation flows through
 * writeStudioAudit, which masks secrets/PII and hashes the caller IP before the
 * row is persisted (append-only audit_events). The masking is pure/testable. */

import type { Context } from "hono";
import type { Env } from "../env.js";
import { insertAuditEvent } from "../db/queries/audit-events.js";

/** Keys whose values must never be stored in the clear (doc 09 §8/9). */
const SENSITIVE_KEY = /(email|token|secret|password|authorization|apikey|api_key|\bip\b)/i;
const MASK = "***";

/**
 * Recursively mask sensitive values while preserving structure. Business context
 * (reason, planId, durationKind…) is kept — only secrets/PII are redacted.
 */
export function maskAuditMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return MASK;
  if (Array.isArray(value)) return value.map((v) => maskAuditMetadata(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? MASK : maskAuditMetadata(v, depth + 1);
    }
    return out;
  }
  return value;
}

const encoder = new TextEncoder();

/** HMAC of an IP with SESSION_SECRET — a stable pseudonym, never the raw address. */
export async function hashIpForAudit(secret: string, ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`audit-ip:${ip}`)));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface StudioAuditInput {
  actor: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Persist one immutable audit row (metadata masked, IP hashed). */
export async function writeStudioAudit(env: Env, input: StudioAuditInput): Promise<void> {
  const metadataJson = input.metadata ? JSON.stringify(maskAuditMetadata(input.metadata)) : null;
  const ipHash = await hashIpForAudit(env.SESSION_SECRET, input.ip);
  await insertAuditEvent(env.DB, {
    actor: input.actor,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadataJson,
    ipHash,
  });
}

/** The client IP as seen by the Worker (Cloudflare header), for the audit hash. */
export function callerIp(c: Context): string | null {
  return c.req.header("cf-connecting-ip") ?? null;
}
