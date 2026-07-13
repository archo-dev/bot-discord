import type { Env } from "../env.js";

const DISCORD_API = "https://discord.com/api/v10";

export class DiscordAPIError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    path: string,
  ) {
    super(`Discord API ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = "DiscordAPIError";
  }
}

// --- Retry policy (M04) ----------------------------------------------------
// Bounded, jittered retry that respects Retry-After. IMPORTANT: only idempotent
// requests (GET/HEAD) are ever retried. A mutation (POST/PATCH/PUT/DELETE) is
// NEVER retried — not even on 429 — because a transport error or 5xx can leave
// it applied, and re-sending would duplicate the side effect. Non-idempotent
// callers get the first response (429 included) and handle it themselves.
const MAX_ATTEMPTS = 3; // 1 initial try + up to 2 retries
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5_000;

export function isIdempotentMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

/** 429 (rate limited) and transient 5xx are worth retrying; 4xx (except 429) are not. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Exponential backoff with jitter, honouring Retry-After (seconds) when Discord
 * sends it. `attempt` is 0-based (delay before retry #1 uses attempt 0). Capped
 * at {@link MAX_DELAY_MS} so a large global Retry-After can't stall a request.
 */
export function computeRetryDelayMs(attempt: number, retryAfterHeader: string | null, random = Math.random()): number {
  const backoff = BASE_DELAY_MS * 2 ** attempt;
  const retryAfterSec = retryAfterHeader != null ? Number(retryAfterHeader) : NaN;
  const retryAfterMs = Number.isFinite(retryAfterSec) ? Math.max(0, retryAfterSec) * 1000 : 0;
  const base = Math.max(backoff, retryAfterMs);
  const jitter = random * 250;
  return Math.min(base + jitter, MAX_DELAY_MS);
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Core retry loop, dependency-injected for testing (fetch + sleep). Retries only
 * when the method is idempotent; caps attempts; sleeps with backoff/jitter/Retry-After.
 */
export async function sendWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  method: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<Response> {
  const retryable = isIdempotentMethod(method);
  for (let attempt = 0; ; attempt++) {
    const hasMoreAttempts = attempt < MAX_ATTEMPTS - 1;
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      // Transport error: retry idempotent requests only, bounded.
      if (retryable && hasMoreAttempts) {
        await sleep(computeRetryDelayMs(attempt, null));
        continue;
      }
      throw err;
    }
    if (retryable && hasMoreAttempts && isRetryableStatus(res.status)) {
      await sleep(computeRetryDelayMs(attempt, res.headers.get("retry-after")));
      continue;
    }
    return res;
  }
}

/**
 * Minimal typed fetch wrapper for the Discord REST API using the bot token.
 * See {@link sendWithRetry}: GET/HEAD are retried (429/5xx, bounded, jittered,
 * Retry-After honoured); mutations are sent exactly once. The global 50 req/s
 * bot limit is shared with the gateway service.
 */
export async function discordRequest(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
  opts: { auditLogReason?: string } = {},
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Bot ${env.DISCORD_TOKEN}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.auditLogReason ? { "x-audit-log-reason": encodeURIComponent(opts.auditLogReason) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  return sendWithRetry(fetch, `${DISCORD_API}${path}`, init, method);
}

/** Like discordRequest but throws DiscordAPIError on non-2xx and parses JSON. */
export async function discordJson<T>(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
  opts: { auditLogReason?: string } = {},
): Promise<T> {
  const res = await discordRequest(env, method, path, body, opts);
  if (!res.ok) throw new DiscordAPIError(res.status, await res.text(), path);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** True when the status means the bot lost access to the guild (kicked / no perms). */
export function isGuildAccessLost(err: unknown): boolean {
  return err instanceof DiscordAPIError && (err.status === 403 || err.status === 404);
}

/** Multipart POST (payload_json + one text file) — used for ticket transcripts. */
export async function discordUpload<T>(
  env: Env,
  path: string,
  payload: unknown,
  file: { name: string; content: string },
): Promise<T> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append("files[0]", new Blob([file.content], { type: "text/plain" }), file.name);
  const res = await fetch(`${DISCORD_API}${path}`, {
    method: "POST",
    headers: { authorization: `Bot ${env.DISCORD_TOKEN}` },
    body: form,
  });
  if (!res.ok) throw new DiscordAPIError(res.status, await res.text(), path);
  return (await res.json()) as T;
}
