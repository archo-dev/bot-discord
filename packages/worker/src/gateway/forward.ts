import {
  MusicStateSchema,
  signInternalRequest,
  type GatewayModuleRuntimeResponse,
  type MusicCommandPayload,
  type MusicCommandResult,
} from "@bot/shared";
import type { Env } from "../env.js";

export interface ForwardResult extends Partial<MusicCommandResult> {
  /** false when GATEWAY_ORIGIN is unset or the gateway didn't answer. */
  reachable: boolean;
  ok: boolean;
  message?: string;
}

export async function fetchGatewayModuleRuntime(env: Env, guildId: string): Promise<GatewayModuleRuntimeResponse | null> {
  if (!env.GATEWAY_ORIGIN || !env.GATEWAY_HTTP_TOKEN) return null;
  const path = `/modules/${guildId}/runtime`;
  try {
    const signature = await signInternalRequest({
      masterSecret: env.GATEWAY_HTTP_TOKEN,
      keyId: env.GATEWAY_HTTP_KEY_ID ?? "worker-current",
      direction: "worker-to-gateway",
      audience: "gateway-http",
      method: "GET",
      path,
      body: "",
    });
    const response = await fetch(`${env.GATEWAY_ORIGIN}${path}`, {
      headers: { authorization: `Bearer ${env.GATEWAY_HTTP_TOKEN}`, ...signature },
      signal: AbortSignal.timeout(4_000),
    });
    return response.ok ? (await response.json()) as GatewayModuleRuntimeResponse : null;
  } catch {
    return null;
  }
}

/** Forwards a music command to the gateway's bearer-guarded HTTP endpoint. */
export async function forwardMusic(env: Env, payload: MusicCommandPayload): Promise<ForwardResult> {
  if (!env.GATEWAY_ORIGIN || !env.GATEWAY_HTTP_TOKEN) return { reachable: false, ok: false };
  try {
    const body = JSON.stringify(payload);
    const signature = await signInternalRequest({
      masterSecret: env.GATEWAY_HTTP_TOKEN,
      keyId: env.GATEWAY_HTTP_KEY_ID ?? "worker-current",
      direction: "worker-to-gateway",
      audience: "gateway-http",
      method: "POST",
      path: "/music",
      body,
    });
    const timeoutMs = payload.command === "play" ? 50_000 : payload.command === "search" ? 17_000 : 12_000;
    const res = await fetch(`${env.GATEWAY_ORIGIN}/music`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GATEWAY_HTTP_TOKEN}`, "content-type": "application/json", ...signature },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { reachable: true, ok: false };
    const responseBody = (await res.json().catch(() => ({}))) as Partial<MusicCommandResult>;
    const parsedState = MusicStateSchema.safeParse(responseBody.state);
    return {
      reachable: true,
      ok: responseBody.ok ?? true,
      message: responseBody.message,
      search: responseBody.search,
      enqueue: responseBody.enqueue,
      state: parsedState.success ? parsedState.data : undefined,
    };
  } catch {
    return { reachable: false, ok: false };
  }
}
