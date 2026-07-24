import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { queryClient } from "./lib/queryClient.js";
import { Toaster } from "./ui/toast.js";
import { ChunkErrorBoundary } from "./ui/error-boundary.js";
import { createDiagnosticId } from "./lib/resilience.js";
import { installGlobalFailureTelemetry, installLoginGuard, renderBootFailure, startNonBlockingHealthCheck } from "./lib/bootstrap.js";
import { reportClientEvent } from "./lib/telemetry.js";
import { ConnectionStatus } from "./ui/connection-status.js";
import { RouterErrorFallback } from "./ui/router-error.js";
import "./index.css";

// Data router (route splat unique, l'arbre <Routes> vit dans App) :
// requis par useBlocker (garde de navigation de la SaveBar, D.S. v2 §4.9).
const router = createBrowserRouter([{ path: "*", element: <App />, errorElement: <RouterErrorFallback /> }]);

// ChunkErrorBoundary AU NIVEAU RACINE : couvre désormais tout l'arbre (racine,
// site public, routes lazy), pas seulement l'espace connecté. Un échec de
// chargement de chunk (ex. hashes obsolètes après un redéploiement) déclenche un
// rechargement unique ; toute autre erreur de rendu affiche un écran d'erreur
// récupérable — jamais un écran de chargement infini ni une page blanche.
installGlobalFailureTelemetry();
installLoginGuard();
startNonBlockingHealthCheck();

const rootElement = document.getElementById("root");
if (rootElement) {
  try {
    createRoot(rootElement).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ChunkErrorBoundary zone="root">
            <RouterProvider router={router} />
          </ChunkErrorBoundary>
          <ConnectionStatus />
          <Toaster />
        </QueryClientProvider>
      </StrictMode>,
    );
  } catch {
    const diagnosticId = createDiagnosticId();
    reportClientEvent({ event: "app_boot_failed", diagnosticId, category: "boot" });
    renderBootFailure(rootElement, diagnosticId);
  }
}
