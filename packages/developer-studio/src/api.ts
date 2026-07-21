import type {
  CreateGrantRequest,
  CreateLifetimeGrantRequest,
  GrantsListResponse,
  StudioAuditPage,
  StudioGuildsListResponse,
  StudioOverview,
  StudioSessionInfo,
  StudioSubscriptionsListResponse,
  StudioUpdatesListResponse,
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" }, credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new StudioApiError(res.status, body.error ?? "error");
  }
  return (await res.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", origin: window.location.origin },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new StudioApiError(res.status, b.error ?? "error");
  }
  return (await res.json()) as T;
}

export const studioApi = {
  session: () => get<StudioSessionInfo>("/studio-api/session"),
  overview: () => get<StudioOverview>("/studio-api/overview"),
  guilds: () => get<StudioGuildsListResponse>("/studio-api/guilds"),
  subscriptions: () => get<StudioSubscriptionsListResponse>("/studio-api/subscriptions"),
  updates: () => get<StudioUpdatesListResponse>("/studio-api/updates"),
  publish: (slug: string) => post<{ ok: boolean; published: boolean }>(`/studio-api/updates/${encodeURIComponent(slug)}/publish`),
  grants: () => get<GrantsListResponse>("/studio-api/subscriptions/granted"),
  grant: (body: CreateGrantRequest) => post<{ ok: boolean; entitlementId: number }>("/studio-api/subscriptions/grant", body),
  grantLifetime: (body: CreateLifetimeGrantRequest) =>
    post<{ ok: boolean; entitlementId: number }>("/studio-api/subscriptions/grant-lifetime", body),
  revoke: (entitlementId: number, reason?: string) =>
    post<{ ok: boolean }>(`/studio-api/subscriptions/${entitlementId}/revoke`, { reason }),
  audit: () => get<StudioAuditPage>("/studio-api/audit"),
};

/** Kick off an OAuth re-consent (step-up) for sensitive actions (M14). */
export function goToStepUp(): void {
  window.location.href = "/studio/auth/step-up";
}
