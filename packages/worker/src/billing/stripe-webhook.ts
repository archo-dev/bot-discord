/** Stripe webhook signature (Web Crypto) + event parsing (M10). Verification runs
 * on the RAW body, constant-time via crypto.subtle.verify, with a timestamp
 * tolerance to reject replays. No dependency. Only verified events may mutate a
 * paid entitlement. */

import type { BillingSubscriptionStatus } from "@bot/shared";

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 2 !== 0 || /[^0-9a-fA-F]/.test(value)) return null;
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** Stripe signature header for a payload — internal + test helper. */
export async function signStripePayload(secret: string, timestampSec: number, body: string): Promise<string> {
  const key = await hmacKey(secret, "sign");
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestampSec}.${body}`)));
  return `t=${timestampSec},v1=${bytesToHex(sig)}`;
}

function parseSigHeader(header: string): { t: number; v1: string[] } | null {
  const v1: string[] = [];
  let t = NaN;
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (k === "t") t = Number(val);
    else if (k === "v1" && val) v1.push(val);
  }
  if (!Number.isFinite(t) || v1.length === 0) return null;
  return { t, v1 };
}

/** Verify a Stripe signature over the raw body. Constant-time; replay-guarded. */
export async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | undefined | null,
  secret: string,
  nowMs: number,
  toleranceSec = 300,
): Promise<boolean> {
  if (!sigHeader || !secret) return false;
  const parsed = parseSigHeader(sigHeader);
  if (!parsed) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - parsed.t) > toleranceSec) return false;
  const key = await hmacKey(secret, "verify");
  const message = encoder.encode(`${parsed.t}.${rawBody}`);
  for (const candidate of parsed.v1) {
    const bytes = hexToBytes(candidate);
    if (bytes && (await crypto.subtle.verify("HMAC", key, bytes, message))) return true;
  }
  return false;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export function parseStripeEvent(rawBody: string): StripeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const id = (parsed as { id?: unknown }).id;
  const type = (parsed as { type?: unknown }).type;
  const object = (parsed as { data?: { object?: unknown } }).data?.object;
  if (typeof id !== "string" || typeof type !== "string" || !object || typeof object !== "object") return null;
  return { id, type, data: { object: object as Record<string, unknown> } };
}

/** Stripe subscription.status → our bounded billing status. */
export function normalizeStripeSubStatus(status: string): BillingSubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "unpaid":
    case "incomplete_expired":
      return "expired";
    default:
      // incomplete / paused / unknown → not fully active, never silently "active".
      return "past_due";
  }
}
