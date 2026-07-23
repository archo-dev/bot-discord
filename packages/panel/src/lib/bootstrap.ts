import { createDiagnosticId, rememberReturnRoute } from "./resilience.js";
import { reportClientEvent } from "./telemetry.js";

export async function checkStartupHealth(fetcher: typeof fetch = fetch, timeoutMs = 5_000, expectedOrigin?: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher("/health", { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: unknown; panelOrigin?: unknown };
    return body.ok === true && (expectedOrigin === undefined || body.panelOrigin === expectedOrigin);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function startNonBlockingHealthCheck(): void {
  void checkStartupHealth(fetch, 5_000, window.location.origin).then((healthy) => {
    if (!healthy) reportClientEvent({ event: "app_boot_failed", diagnosticId: createDiagnosticId(), category: "boot" });
  });
}

export function installLoginGuard(): () => void {
  const claimNavigation = createSingleFlightGate();
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href="/auth/login"]') : null;
    if (!target) return;
    if (!claimNavigation()) {
      event.preventDefault();
      return;
    }
    rememberReturnRoute(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    target.setAttribute("aria-disabled", "true");
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

export function createSingleFlightGate(): () => boolean {
  let claimed = false;
  return () => {
    if (claimed) return false;
    claimed = true;
    return true;
  };
}

export function installGlobalFailureTelemetry(): () => void {
  const onError = () => reportClientEvent({ event: "app_boot_failed", diagnosticId: createDiagnosticId(), category: "boot" });
  const onRejection = () => reportClientEvent({ event: "app_boot_failed", diagnosticId: createDiagnosticId(), category: "boot" });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

export function renderBootFailure(root: HTMLElement, diagnosticId: string): void {
  root.replaceChildren();
  const container = document.createElement("main");
  container.setAttribute("role", "alert");
  container.className = "mx-auto flex min-h-screen max-w-xl items-center px-4 text-zinc-100";
  const card = document.createElement("div");
  card.className = "w-full rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center";
  const title = document.createElement("h1");
  title.className = "text-xl font-semibold";
  title.textContent = "Le panel n’a pas pu démarrer";
  const detail = document.createElement("p");
  detail.className = "mt-2 text-sm text-zinc-400";
  detail.textContent = `Rechargez la page. Diagnostic : ${diagnosticId}`;
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "mt-5 rounded-lg border border-zinc-700 px-4 py-2 text-sm";
  reload.textContent = "Recharger";
  reload.addEventListener("click", () => window.location.reload());
  card.append(title, detail, reload);
  container.append(card);
  root.append(container);
}
