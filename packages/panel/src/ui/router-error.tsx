import { useEffect, useState } from "react";
import { useRouteError } from "react-router";
import { createDiagnosticId } from "../lib/resilience.js";
import { classifyClientErrorType, reportClientEvent } from "../lib/telemetry.js";
import { attemptChunkRecoveryReload, isChunkLoadError } from "./error-boundary.js";
import { Button } from "./kit.js";

export function RouterErrorFallback() {
  const error = useRouteError();
  const [diagnosticId] = useState(createDiagnosticId);
  const [copied, setCopied] = useState(false);
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    reportClientEvent({
      event: chunk ? "chunk_load_failed" : "error_boundary_triggered",
      diagnosticId,
      category: chunk ? "chunk" : "render",
      zone: "root",
      errorType: classifyClientErrorType(error),
    });
    if (chunk) attemptChunkRecoveryReload(diagnosticId);
  }, [chunk, diagnosticId, error]);

  const logout = async () => {
    try { await fetch("/auth/logout", { method: "POST" }); } finally { window.location.assign("/"); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(diagnosticId); setCopied(true); } catch { /* unavailable */ }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-10" role="alert">
      <div className="w-full rounded-xl border border-(--border) bg-zinc-900 p-6 text-center">
        <h1 className="font-display text-xl font-semibold text-zinc-100">
          {chunk ? "Une nouvelle version du panel est disponible" : "Le panel a rencontré une erreur"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">Vos données n’ont pas été modifiées. Réessayez avec la version courante du panel.</p>
        <p className="mt-3 font-mono text-xs text-zinc-500">Diagnostic : {diagnosticId}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => window.location.replace(window.location.href)}>Réessayer</Button>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Recharger l’application</Button>
          <Button variant="ghost" size="sm" onClick={() => void copy()}>{copied ? "Copié" : "Copier le diagnostic"}</Button>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>Se déconnecter</Button>
        </div>
      </div>
    </div>
  );
}
