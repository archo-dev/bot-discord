/** Map opaque API error codes to human FR messages (Lot 3/4). Never surface a
 * raw technical code, stack, or response body to the operator; unknown codes
 * fall back to a generic message. */
export interface ErrorInfo {
  title: string;
  description: string;
}

const MAP: Record<string, ErrorInfo> = {
  network_error: { title: "Connexion impossible", description: "Vérifiez votre réseau, puis réessayez." },
  timeout: { title: "Délai dépassé", description: "Le serveur a mis trop de temps à répondre. Réessayez." },
  unauthorized: { title: "Session expirée", description: "Votre session n'est plus valide. Reconnectez-vous." },
  forbidden: { title: "Accès refusé", description: "Vous n'avez pas l'autorisation d'effectuer cette action." },
  not_found: { title: "Introuvable", description: "La ressource demandée est introuvable." },
  conflict: { title: "Conflit détecté", description: "L'état a changé entre-temps. Rafraîchissez, puis réessayez." },
  rate_limited: { title: "Trop de requêtes", description: "Patientez un instant avant de réessayer." },
  service_unavailable: { title: "Service indisponible", description: "Le service est temporairement indisponible. Réessayez plus tard." },
  validation_error: { title: "Données invalides", description: "Vérifiez les champs saisis, puis réessayez." },
  step_up_required: { title: "Ré-authentification requise", description: "Cette action nécessite une nouvelle authentification Discord." },
};

const FALLBACK: ErrorInfo = { title: "Une erreur est survenue", description: "L'opération a échoué. Réessayez." };

export function errorInfoFr(code: string): ErrorInfo {
  return MAP[code] ?? FALLBACK;
}

/** Short description only (used where a single line is enough). */
export function errorMessageFr(code: string): string {
  return errorInfoFr(code).description;
}
