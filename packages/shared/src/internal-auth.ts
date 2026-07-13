export const INTERNAL_AUTH_VERSION = "1" as const;
export const INTERNAL_AUTH_WINDOW_SECONDS = 120;

export type InternalAudience = "worker-internal" | "gateway-http";
export type InternalDirection = "gateway-to-worker" | "worker-to-gateway";

export interface InternalSigningInput {
  masterSecret: string;
  keyId: string;
  direction: InternalDirection;
  audience: InternalAudience;
  method: string;
  path: string;
  body: string;
  timestamp?: number;
  nonce?: string;
}

export interface InternalKeyCandidate {
  masterSecret: string;
  keyId: string;
}

export type InternalVerification =
  | { ok: true; nonce: string; timestamp: number; keyId: string }
  | { ok: false; reason: "missing" | "version" | "key" | "timestamp" | "nonce" | "signature" };

const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): ArrayBuffer | null {
  if (!/^[0-9a-f]{64}$/.test(value)) return null;
  return new Uint8Array(value.match(/../g)!.map((part) => Number.parseInt(part, 16))).buffer;
}

export function normalizeInternalPath(value: string): string {
  const url = new URL(value, "https://internal.invalid");
  const entries = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  const query = new URLSearchParams(entries).toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

async function deriveKey(masterSecret: string, direction: InternalDirection, keyId: string) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(masterSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("botdiscord-m02-internal-auth-v1"),
      info: encoder.encode(`${direction}:${keyId}`),
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

async function canonical(input: Omit<InternalSigningInput, "masterSecret"> & { timestamp: number; nonce: string }): Promise<string> {
  return [
    INTERNAL_AUTH_VERSION,
    input.keyId,
    input.method.toUpperCase(),
    normalizeInternalPath(input.path),
    input.audience,
    String(input.timestamp),
    input.nonce,
    await sha256Hex(input.body),
  ].join("\n");
}

export async function signInternalRequest(input: InternalSigningInput): Promise<Record<string, string>> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const message = await canonical({ ...input, timestamp, nonce });
  const key = await deriveKey(input.masterSecret, input.direction, input.keyId);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return {
    "x-internal-version": INTERNAL_AUTH_VERSION,
    "x-internal-key-id": input.keyId,
    "x-internal-audience": input.audience,
    "x-internal-timestamp": String(timestamp),
    "x-internal-nonce": nonce,
    "x-internal-signature": bytesToHex(signature),
  };
}

export async function verifyInternalRequest(args: {
  headers: Headers;
  keys: readonly InternalKeyCandidate[];
  direction: InternalDirection;
  audience: InternalAudience;
  method: string;
  path: string;
  body: string;
  nowSeconds?: number;
}): Promise<InternalVerification> {
  const version = args.headers.get("x-internal-version");
  const keyId = args.headers.get("x-internal-key-id");
  const audience = args.headers.get("x-internal-audience");
  const timestampRaw = args.headers.get("x-internal-timestamp");
  const nonce = args.headers.get("x-internal-nonce");
  const signatureRaw = args.headers.get("x-internal-signature");
  if (!version || !keyId || !audience || !timestampRaw || !nonce || !signatureRaw) return { ok: false, reason: "missing" };
  if (version !== INTERNAL_AUTH_VERSION || audience !== args.audience) return { ok: false, reason: "version" };
  const candidate = args.keys.find((key) => key.keyId === keyId);
  if (!candidate) return { ok: false, reason: "key" };
  const timestamp = Number(timestampRaw);
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > INTERNAL_AUTH_WINDOW_SECONDS) return { ok: false, reason: "timestamp" };
  if (!/^[0-9a-f]{32,64}$/.test(nonce)) return { ok: false, reason: "nonce" };
  const signature = hexToBytes(signatureRaw);
  if (!signature) return { ok: false, reason: "signature" };
  const message = await canonical({
    keyId,
    direction: args.direction,
    audience: args.audience,
    method: args.method,
    path: args.path,
    body: args.body,
    timestamp,
    nonce,
  });
  const key = await deriveKey(candidate.masterSecret, args.direction, keyId);
  const ok = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(message));
  return ok ? { ok: true, nonce, timestamp, keyId } : { ok: false, reason: "signature" };
}
