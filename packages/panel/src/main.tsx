import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { queryClient } from "./lib/queryClient.js";
import { Toaster } from "./ui/toast.js";
import { ChunkErrorBoundary } from "./ui/error-boundary.js";
import "./index.css";

// Data router (route splat unique, l'arbre <Routes> vit dans App) :
// requis par useBlocker (garde de navigation de la SaveBar, D.S. v2 §4.9).
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

// ChunkErrorBoundary AU NIVEAU RACINE : couvre désormais tout l'arbre (racine,
// site public, routes lazy), pas seulement l'espace connecté. Un échec de
// chargement de chunk (ex. hashes obsolètes après un redéploiement) déclenche un
// rechargement unique ; toute autre erreur de rendu affiche un écran d'erreur
// récupérable — jamais un écran de chargement infini ni une page blanche.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ChunkErrorBoundary>
        <RouterProvider router={router} />
      </ChunkErrorBoundary>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
