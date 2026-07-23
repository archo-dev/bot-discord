import { createDiagnosticId } from "./resilience.js";
import { reportClientEvent, type ClientErrorCategory } from "./telemetry.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly fields?: Record<string, string[] | undefined>,
    public readonly retryAfterSeconds?: number,
    public readonly requestId?: string,
    public readonly category: ClientErrorCategory = "http",
  ) {
    super(`${status}: ${code}`);
    this.name = "ApiError";
  }
}

function frenchifyZodMessage(msg: string): string {
  let match = /^Too big: expected string to have <=(\d+)/.exec(msg);
  if (match) return `Trop long — ${match[1]} caractères maximum.`;
  match = /^Too small: expected string to have >=(\d+)/.exec(msg);
  if (match) return Number(match[1]) <= 1 ? "Ce champ est requis." : `Trop court — ${match[1]} caractères minimum.`;
  match = /^Too big: expected number to be <=(\d+)/.exec(msg);
  if (match) return `Doit être au plus ${match[1]}.`;
  match = /^Too small: expected number to be >=(\d+)/.exec(msg);
  if (match) return `Doit être au moins ${match[1]}.`;
  if (msg.startsWith("Invalid") || msg.startsWith("Too")) return "Valeur invalide.";
  return msg;
}

export function fieldError(error: unknown, field: string): string | undefined {
  const raw = error instanceof ApiError ? error.fields?.[field]?.[0] : undefined;
  return raw === undefined ? undefined : frenchifyZodMessage(raw);
}

const DEFAULT_TIMEOUT_MS = 20_000;
const pendingControllers = new Set<AbortController>();

export function abortPendingApiRequests(): void {
  for (const controller of pendingControllers) controller.abort(new DOMException("Session changed", "AbortError"));
  pendingControllers.clear();
}

export async function api<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init ?? {};
  const requestId = createDiagnosticId();
  const controller = new AbortController();
  pendingControllers.add(controller);
  const abortFromCaller = () => controller.abort(signal?.reason ?? new DOMException("Request cancelled", "AbortError"));
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);

  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(rest.body !== undefined ? { "content-type": "application/json" } : {}),
        "x-request-id": requestId,
        ...rest.headers,
      },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const category: ClientErrorCategory = controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError"
      ? "timeout"
      : "network";
    const code = category === "timeout"
      ? "request_timeout"
      : typeof navigator !== "undefined" && navigator.onLine === false
        ? "offline"
        : "network_error";
    reportClientEvent({ event: "api_request_failed", diagnosticId: requestId, requestId, category });
    throw new ApiError(0, code, undefined, undefined, requestId, category);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
    pendingControllers.delete(controller);
  }

  const responseRequestId = response.headers.get("x-request-id") ?? requestId;
  if (!response.ok) {
    let code = "error";
    let fields: Record<string, string[] | undefined> | undefined;
    let retryAfterSeconds: number | undefined;
    try {
      const body = (await response.json()) as { error?: string; fields?: Record<string, string[] | undefined>; retryAfterSeconds?: number };
      code = body.error ?? "error";
      fields = body.fields;
      if (Number.isFinite(body.retryAfterSeconds) && body.retryAfterSeconds! > 0) retryAfterSeconds = Math.ceil(body.retryAfterSeconds!);
    } catch { /* non-JSON error body */ }
    const retryAfterHeader = Number(response.headers.get("retry-after"));
    if (retryAfterSeconds === undefined && Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) retryAfterSeconds = Math.ceil(retryAfterHeader);
    if (response.status === 401 && typeof window !== "undefined" && (path !== "/api/me" || code === "session_expired" || code === "session_revoked")) {
      window.dispatchEvent(new Event("panel:session-expired"));
    }
    reportClientEvent({ event: "api_request_failed", diagnosticId: responseRequestId, requestId: responseRequestId, category: "http", status: response.status });
    throw new ApiError(response.status, code, fields, retryAfterSeconds, responseRequestId);
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    reportClientEvent({ event: "api_request_failed", diagnosticId: responseRequestId, requestId: responseRequestId, category: "invalid_response", status: response.status });
    throw new ApiError(502, "invalid_json_response", undefined, undefined, responseRequestId, "invalid_response");
  }
}

export const guildIconUrl = (id: string, icon: string | null, size = 64): string | null =>
  icon ? `https://cdn.discordapp.com/icons/${id}/${icon}.png?size=${size}` : null;

export const avatarUrl = (id: string, avatar: string | null, size = 64): string =>
  avatar
    ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=${size}`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) >> 22n) % 6}.png`;
