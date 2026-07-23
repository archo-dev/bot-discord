import { Component, type ErrorInfo, type ReactNode } from "react";
import { createDiagnosticId, readStoredValue, writeStoredValue, type StorageLike } from "../lib/resilience.js";
import { classifyClientErrorType, reportClientEvent } from "../lib/telemetry.js";
import { Button } from "./kit.js";

const RELOAD_GUARD_KEY = "panel:chunk-reload:v1";
const RELOAD_GUARD_MS = 60_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /chunkloaderror|dynamically imported module|importing a module script failed|failed to fetch dynamically|error loading|module script/i.test(
    `${error.name} ${error.message}`,
  );
}

export function claimRecoveryReload(storage: StorageLike, now = Date.now()): boolean {
  const last = readStoredValue(storage, RELOAD_GUARD_KEY, (value): value is number => typeof value === "number", now);
  if (last !== null && now - last < RELOAD_GUARD_MS) return false;
  return writeStoredValue(storage, RELOAD_GUARD_KEY, now, now + RELOAD_GUARD_MS);
}

function tryReloadOnce(diagnosticId: string): boolean {
  try {
    if (!claimRecoveryReload(sessionStorage)) return false;
  } catch {
    return false;
  }
  reportClientEvent({ event: "recovery_reload_triggered", diagnosticId, category: "chunk" });
  window.location.reload();
  return true;
}

interface BoundaryProps {
  children: ReactNode;
  zone?: "root" | "client" | "guild" | "modules" | "automations" | "subscription";
  resetKey?: string;
}

interface State {
  failed: boolean;
  chunk: boolean;
  diagnosticId: string | null;
  copied: boolean;
}

export class PanelErrorBoundary extends Component<BoundaryProps, State> {
  state: State = { failed: false, chunk: false, diagnosticId: null, copied: false };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, chunk: isChunkLoadError(error), diagnosticId: createDiagnosticId(), copied: false };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    const diagnosticId = this.state.diagnosticId ?? createDiagnosticId();
    const chunk = isChunkLoadError(error);
    reportClientEvent({
      event: chunk ? "chunk_load_failed" : "error_boundary_triggered",
      diagnosticId,
      category: chunk ? "chunk" : "render",
      zone: this.props.zone ?? "root",
      errorType: classifyClientErrorType(error),
    });
    if (chunk) tryReloadOnce(diagnosticId);
  }

  componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false, chunk: false, diagnosticId: null, copied: false });
  }

  private logout = async (): Promise<void> => {
    try { await fetch("/auth/logout", { method: "POST" }); } finally { window.location.assign("/"); }
  };

  private copyDiagnostic = async (): Promise<void> => {
    if (!this.state.diagnosticId) return;
    try {
      await navigator.clipboard.writeText(this.state.diagnosticId);
      this.setState({ copied: true });
    } catch { /* clipboard can be unavailable */ }
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-xl items-center px-4 py-10" role="alert">
        <div className="w-full rounded-xl border border-(--border) bg-zinc-900 p-6 text-center">
          <h1 className="font-display text-xl font-semibold text-zinc-100">
            {this.state.chunk ? "Une nouvelle version du panel est disponible" : "Cette zone du panel a rencontré une erreur"}
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Vos données n’ont pas été modifiées. Vous pouvez réessayer ou recharger la version courante.
          </p>
          <p className="mt-3 font-mono text-xs text-zinc-500">Diagnostic : {this.state.diagnosticId}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => this.setState({ failed: false, chunk: false, diagnosticId: null, copied: false })}>Réessayer</Button>
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Recharger</Button>
            <Button variant="ghost" size="sm" onClick={() => void this.copyDiagnostic()}>{this.state.copied ? "Copié" : "Copier le diagnostic"}</Button>
            <Button variant="ghost" size="sm" onClick={() => void this.logout()}>Se déconnecter</Button>
          </div>
        </div>
      </div>
    );
  }
}

export const ChunkErrorBoundary = PanelErrorBoundary;
