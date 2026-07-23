import type { QueryClient } from "@tanstack/react-query";
import { abortPendingApiRequests } from "./api.js";
import { createDiagnosticId, rememberReturnRoute } from "./resilience.js";
import { reportClientEvent } from "./telemetry.js";

let recoveryStarted = false;

export function isRecoverablePanelRoute(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/app") || pathname.startsWith("/guilds/");
}

export async function recoverExpiredSession(queryClient: QueryClient): Promise<void> {
  if (recoveryStarted || typeof window === "undefined") return;
  recoveryStarted = true;
  const intended = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (isRecoverablePanelRoute(window.location.pathname)) rememberReturnRoute(intended);
  reportClientEvent({ event: "session_expired", diagnosticId: createDiagnosticId(), category: "session" });
  abortPendingApiRequests();
  await queryClient.cancelQueries();
  queryClient.clear();
  window.location.assign("/auth/login");
}

export function resetSessionRecoveryForTests(): void {
  recoveryStarted = false;
}
