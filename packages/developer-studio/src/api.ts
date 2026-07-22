import type {
  CreateGrantRequest,
  CreateLifetimeGrantRequest,
  GrantsListResponse,
  RolloutFlagState,
  RolloutResponse,
  StudioAuditPage,
  StudioErrorsResponse,
  StudioGuildsListResponse,
  StudioMetricsResponse,
  StudioOverview,
  StudioSessionInfo,
  StudioSupportListResponse,
  StudioSubscriptionsListResponse,
  StudioUpdatesListResponse,
  StudioUsersListResponse,
} from "@bot/shared";

/** Thin fetch client for /studio-api/*. Cookies (studio_session) ride along;
 * the server is the sole authority on permissions — the UI only mirrors them. */

export class StudioApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

function pagePath(path: string, page: number): string {
  return `${path}?page=${page}&pageSize=20`;
}

async function throwApiError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) window.dispatchEvent(new Event("studio:session-expired"));
  throw new StudioApiError(res.status, body.error ?? "error");
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { accept: "application/json" },
    credentials: "same-origin",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return throwApiError(res);
  return (await res.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    credentials: "same-origin",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return throwApiError(res);
  return (await res.json()) as T;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: { accept: "application/json", "content-type": "application/json" },
    credentials: "same-origin",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify(body),
  });
  if (!res.ok) return throwApiError(res);
  return (await res.json()) as T;
}

export const studioApi = {
  session: () => get<StudioSessionInfo>("/studio-api/session"),
  logout: () => post<{ ok: true }>("/studio/auth/logout"),
  overview: () => get<StudioOverview>("/studio-api/overview"),
  users: (page = 1) => get<StudioUsersListResponse>(pagePath("/studio-api/users", page)),
  guilds: (page = 1) => get<StudioGuildsListResponse>(pagePath("/studio-api/guilds", page)),
  subscriptions: (page = 1) => get<StudioSubscriptionsListResponse>(pagePath("/studio-api/subscriptions", page)),
  support: (page = 1, status?: "open" | "pending" | "resolved" | "closed") =>
    get<StudioSupportListResponse>(`${pagePath("/studio-api/support", page)}${status ? `&status=${status}` : ""}`),
  updates: (page = 1) => get<StudioUpdatesListResponse>(pagePath("/studio-api/updates", page)),
  publish: (slug: string) => post<{ ok: boolean; published: boolean }>(`/studio-api/updates/${encodeURIComponent(slug)}/publish`),
  grants: (page = 1) => get<GrantsListResponse>(pagePath("/studio-api/subscriptions/granted", page)),
  grant: (body: CreateGrantRequest) => post<{ ok: boolean; entitlementId: number }>("/studio-api/subscriptions/grant", body),
  grantLifetime: (body: CreateLifetimeGrantRequest) =>
    post<{ ok: boolean; entitlementId: number }>("/studio-api/subscriptions/grant-lifetime", body),
  revoke: (entitlementId: number, reason?: string) =>
    post<{ ok: boolean }>(`/studio-api/subscriptions/${entitlementId}/revoke`, { reason }),
  audit: (page = 1) => get<StudioAuditPage>(pagePath("/studio-api/audit", page)),
  metrics: () => get<StudioMetricsResponse>("/studio-api/metrics"),
  errors: () => get<StudioErrorsResponse>("/studio-api/errors"),
  rollout: () => get<RolloutResponse>("/studio-api/rollout"),
  setRollout: (flag: string, body: { global: boolean; guilds: string[] }) =>
    put<RolloutFlagState>(`/studio-api/rollout/${encodeURIComponent(flag)}`, body),
};

/** Kick off an OAuth re-consent (step-up) for sensitive actions (M14). */
export function goToStepUp(): void {
  window.location.href = "/studio/auth/step-up";
}
