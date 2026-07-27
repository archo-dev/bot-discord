import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PublicStatus,
  StudioAuditEvent,
  StudioAuditPage,
  StudioErrorsResponse,
  StudioOverview,
} from "@bot/shared";
import { StudioApiError, studioApi } from "../api.js";

export interface OverviewState {
  /** Primary source — its absence drives the page-level error/skeleton. */
  overview: StudioOverview | null;
  /** Best-effort sources: null means « not available », never « OK ». */
  status: PublicStatus | null;
  errors: StudioErrorsResponse | null;
  audit: StudioAuditEvent[] | null;
  /** Code of the last primary-load failure (null when the last load succeeded). */
  error: string | null;
  /** True only until the first settle (drives the skeleton). */
  loading: boolean;
  /** True while a manual/initial refresh is in flight (drives the busy button). */
  refreshing: boolean;
  lastUpdatedAt: string | null;
  refresh: () => void;
}

/**
 * Overview data aggregator (Lot 3). Fetches only existing GET endpoints and
 * degrades gracefully: the overview is the backbone; health, errors and audit
 * are best-effort and permission-gated by the caller. No new endpoint, no
 * contract change. A failed secondary source yields `null` (rendered as
 * « Inconnu »/« Non disponible »/empty), never a fake success.
 */
export function useOverview({
  canErrors,
  canAudit,
  onRefreshError,
}: {
  canErrors: boolean;
  canAudit: boolean;
  /** Called when a refresh (not the initial load) fails while data is shown. */
  onRefreshError?: (code: string) => void;
}): OverviewState {
  const [overview, setOverview] = useState<StudioOverview | null>(null);
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [errors, setErrors] = useState<StudioErrorsResponse | null>(null);
  const [audit, setAudit] = useState<StudioAuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  // Refs so callbacks/flags don't churn the memoized `load` (no refetch loop).
  const onRefreshErrorRef = useRef(onRefreshError);
  onRefreshErrorRef.current = onRefreshError;
  const hadDataRef = useRef(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const isRefresh = hadDataRef.current;
    const [ov, st, er, au] = await Promise.allSettled([
      studioApi.overview(),
      studioApi.status(),
      canErrors ? studioApi.errors() : Promise.resolve<StudioErrorsResponse | null>(null),
      canAudit ? studioApi.audit(1) : Promise.resolve<StudioAuditPage | null>(null),
    ]);

    if (ov.status === "fulfilled") {
      setOverview(ov.value);
      setError(null);
      hadDataRef.current = true;
    } else {
      // Keep any previously loaded overview visible; surface a refresh error.
      const code = ov.reason instanceof StudioApiError ? ov.reason.code : "network_error";
      setError(code);
      if (isRefresh) onRefreshErrorRef.current?.(code);
    }
    setStatus(st.status === "fulfilled" ? st.value : null);
    setErrors(er.status === "fulfilled" ? er.value : null);
    setAudit(au.status === "fulfilled" && au.value ? au.value.items : null);

    setLastUpdatedAt(new Date().toISOString());
    setLoading(false);
    setRefreshing(false);
  }, [canErrors, canAudit]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    overview,
    status,
    errors,
    audit,
    error,
    loading,
    refreshing,
    lastUpdatedAt,
    refresh: () => void load(),
  };
}
