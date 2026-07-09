import type { MusicCommandPayload } from "@bot/shared";
import type { Env } from "../env.js";

export interface ForwardResult {
  /** false when GATEWAY_ORIGIN is unset or the gateway didn't answer. */
  reachable: boolean;
  ok: boolean;
  message?: string;
}

/** Forwards a music command to the gateway's bearer-guarded HTTP endpoint. */
export async function forwardMusic(env: Env, payload: MusicCommandPayload): Promise<ForwardResult> {
  if (!env.GATEWAY_ORIGIN || !env.GATEWAY_HTTP_TOKEN) return { reachable: false, ok: false };
  try {
    const res = await fetch(`${env.GATEWAY_ORIGIN}/music`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GATEWAY_HTTP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { reachable: true, ok: false };
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    return { reachable: true, ok: body.ok ?? true, message: body.message };
  } catch {
    return { reachable: false, ok: false };
  }
}
