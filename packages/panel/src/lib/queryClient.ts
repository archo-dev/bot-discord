import { MutationCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api.js";
import { toast } from "../ui/toast.js";

/*
 * QueryClient global (D.S. v2 §4.3 / plan §A4).
 * « Chaque action a un écho » : toute mutation qui échoue produit un toast
 * d'erreur, sans que chaque page ait à le câbler. Les succès ponctuels
 * s'annoncent via meta.successMessage ; les formulaires passent par la SaveBar.
 */

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Toast de succès (actions ponctuelles : publier, supprimer, révoquer…). */
      successMessage?: string;
      /** Message d'erreur métier (sinon message générique). */
      errorMessage?: string;
      /** Coupe le toast d'erreur global (la page gère elle-même, ex. SaveBar). */
      silentError?: boolean;
    };
  }
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      const msg = mutation.meta?.successMessage;
      if (msg) toast.success(msg);
    },
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silentError) return;
      const fallback =
        error instanceof ApiError && error.status === 403
          ? "Action refusée — permissions insuffisantes."
          : "L'opération a échoué — réessayez.";
      toast.error(mutation.meta?.errorMessage ?? fallback);
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
          return false;
        }
        return failureCount < 2;
      },
      staleTime: 30_000,
    },
  },
});
