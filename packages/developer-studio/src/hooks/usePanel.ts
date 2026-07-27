import { useEffect, useState } from "react";
import { StudioApiError } from "../api.js";

/**
 * Shared read-first panel loader (extracted verbatim from App — M12). Cancels
 * stale results and exposes a retry that bumps an internal attempt counter.
 */
export function usePanel<T>(
  loader: () => Promise<T>,
  reloadKey: unknown = null,
): { data: T | null; error: string | null; retry: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    loader()
      .then((value) => { if (active) setData(value); })
      .catch((e: unknown) => { if (active) setError(e instanceof StudioApiError ? e.code : "network_error"); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, reloadKey]);
  return { data, error, retry: () => setAttempt((value) => value + 1) };
}
