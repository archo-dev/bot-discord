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

/**
 * Minimal typed fetch wrapper for the Discord REST API using the bot token.
 * Retries once on 429 (respecting retry_after) — the global 50 req/s bot
 * limit is shared with the future gateway service.
 */
export async function discordRequest(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
  opts: { auditLogReason?: string } = {},
): Promise<Response> {
  const doFetch = (): Promise<Response> =>
    fetch(`${DISCORD_API}${path}`, {
      method,
      headers: {
        authorization: `Bot ${env.DISCORD_TOKEN}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.auditLogReason ? { "x-audit-log-reason": encodeURIComponent(opts.auditLogReason) } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch();
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "1");
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
    res = await doFetch();
  }
  return res;
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
