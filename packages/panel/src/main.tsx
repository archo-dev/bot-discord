import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { queryClient } from "./lib/queryClient.js";
import { Toaster } from "./ui/toast.js";
import "./index.css";

// Data router (route splat unique, l'arbre <Routes> vit dans App) :
// requis par useBlocker (garde de navigation de la SaveBar, D.S. v2 §4.9).
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
