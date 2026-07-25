const OAUTH_STATE_RE = /^[0-9a-f]{64}$/;
export const OAUTH_STATE_MAX_AGE_SECONDS = 300;
const OAUTH_STATE_MAX_AGE_MS = OAUTH_STATE_MAX_AGE_SECONDS * 1000;

export type OAuthStateFailureCode =
  | "missing_state"
  | "invalid_state_format"
  | "missing_cookie"
  | "state_mismatch"
  | "state_expired";

export type OAuthStateValidation = { ok: true } | { ok: false; code: OAuthStateFailureCode };

const encoder = new TextEncoder();

function randomHex(bytesLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compare fixed-format strings without returning early on their contents. */
function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function signState(secret: string, purpose: string, state: string, issuedAt: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${purpose}:${state}:${issuedAt}`)));
}

export function createOAuthStateValue(): string {
  return randomHex(32);
}

export async function createOAuthStateCookieValue(
  secret: string,
  purpose: string,
  state: string,
  issuedAt = Date.now(),
): Promise<string> {
  const signature = await signState(secret, purpose, state, issuedAt);
  return `${state}.${issuedAt}.${signature}`;
}

export async function validateOAuthStateValue(
  secret: string,
  purpose: string,
  state: string | undefined,
  cookieValue: string | undefined,
  now = Date.now(),
): Promise<OAuthStateValidation> {
  if (!state) return { ok: false, code: "missing_state" };
  if (!OAUTH_STATE_RE.test(state)) return { ok: false, code: "invalid_state_format" };
  if (!cookieValue) return { ok: false, code: "missing_cookie" };

  const parts = cookieValue.split(".");
  if (parts.length !== 3) return { ok: false, code: "state_mismatch" };
  const [cookieState, issuedAtRaw, suppliedSignature] = parts as [string, string, string];
  if (!OAUTH_STATE_RE.test(cookieState) || !/^\d{13}$/.test(issuedAtRaw) || !/^[0-9a-f]{64}$/.test(suppliedSignature)) {
    return { ok: false, code: "state_mismatch" };
  }
  if (!constantTimeEqual(state, cookieState)) return { ok: false, code: "state_mismatch" };

  const issuedAt = Number(issuedAtRaw);
  const expectedSignature = await signState(secret, purpose, cookieState, issuedAt);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return { ok: false, code: "state_mismatch" };
  if (issuedAt > now || now - issuedAt > OAUTH_STATE_MAX_AGE_MS) return { ok: false, code: "state_expired" };

  return { ok: true };
}

// --- Studio step-up, session-bound state (M14, option B) --------------------
// The Studio session cookie is SameSite=Strict, so it is withheld on the Discord
// step-up return (cross-site top-level navigation). Instead of relying on that
// cookie at the callback, we bind the current session id (sid) into a SIGNED,
// Lax step-up cookie: `nonce.issuedAt.sid.signature`. The random `nonce` also
// travels in the URL `state` (CSRF: URL nonce must equal the cookie nonce). The
// sid NEVER appears in the URL. The HMAC covers nonce+issuedAt+sid under a
// DISTINCT message prefix, so a login/panel state can never validate here.

const STUDIO_SESSION_ID_RE = /^[0-9a-f]{64}$/;

export type StudioStepUpStateValidation = { ok: true; sid: string } | { ok: false; code: OAuthStateFailureCode };

async function signStepUpBinding(secret: string, nonce: string, issuedAt: number, sid: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`studio-step-up-bound:${nonce}:${issuedAt}:${sid}`)),
  );
}

export async function createStudioStepUpBinding(
  secret: string,
  sid: string,
  nonce: string,
  issuedAt = Date.now(),
): Promise<string> {
  const signature = await signStepUpBinding(secret, nonce, issuedAt, sid);
  return `${nonce}.${issuedAt}.${sid}.${signature}`;
}

export async function validateStudioStepUpBinding(
  secret: string,
  urlState: string | undefined,
  cookieValue: string | undefined,
  now = Date.now(),
): Promise<StudioStepUpStateValidation> {
  if (!urlState) return { ok: false, code: "missing_state" };
  if (!OAUTH_STATE_RE.test(urlState)) return { ok: false, code: "invalid_state_format" };
  if (!cookieValue) return { ok: false, code: "missing_cookie" };

  const parts = cookieValue.split(".");
  if (parts.length !== 4) return { ok: false, code: "state_mismatch" };
  const [nonce, issuedAtRaw, sid, suppliedSignature] = parts as [string, string, string, string];
  if (
    !OAUTH_STATE_RE.test(nonce) ||
    !/^\d{13}$/.test(issuedAtRaw) ||
    !STUDIO_SESSION_ID_RE.test(sid) ||
    !/^[0-9a-f]{64}$/.test(suppliedSignature)
  ) {
    return { ok: false, code: "state_mismatch" };
  }
  // CSRF: the URL nonce must equal the signed cookie nonce.
  if (!constantTimeEqual(urlState, nonce)) return { ok: false, code: "state_mismatch" };
  const issuedAt = Number(issuedAtRaw);
  const expectedSignature = await signStepUpBinding(secret, nonce, issuedAt, sid);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return { ok: false, code: "state_mismatch" };
  if (issuedAt > now || now - issuedAt > OAUTH_STATE_MAX_AGE_MS) return { ok: false, code: "state_expired" };

  return { ok: true, sid };
}
