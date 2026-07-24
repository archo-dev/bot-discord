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
      const fallback = error instanceof ApiError
        ? error.category === "network"
          ? "Connexion indisponible — vérifiez votre réseau puis réessayez."
          : error.category === "timeout"
            ? "Le serveur met trop de temps à répondre — réessayez."
          : error.code === "target_is_guild_owner"
          ? "Action refusée : le propriétaire du serveur ne peut pas être sanctionné. Un avertissement automatique a été enregistré."
          : error.code === "quota_exceeded"
          ? "Quota de sécurité atteint — réessayez demain."
          : error.code === "csrf_rejected"
            ? "Origine de la requête refusée — rechargez le panel officiel."
            : error.status === 401
              ? "Votre session a expiré — reconnectez-vous."
              : error.status === 403
                ? "Action refusée — permissions insuffisantes."
                : "L'opération a échoué — réessayez."
        : "L'opération a échoué — réessayez.";
      toast.error(mutation.meta?.errorMessage ?? fallback);
    },
  }),
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      retryDelay: retryDelayMs,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0) return failureCount < 2;
  return error.status >= 500 && failureCount < 2;
}

export function retryDelayMs(attempt: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterSeconds !== undefined) {
    return Math.min(error.retryAfterSeconds * 1_000, 10_000);
  }
  return Math.min(500 * 2 ** attempt, 4_000);
}
