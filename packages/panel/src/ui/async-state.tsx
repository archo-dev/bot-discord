import type { ReactNode } from "react";
import { ApiError } from "../lib/api.js";
import { EmptyState, ErrorCard } from "./kit.js";

export function safeErrorReference(error: unknown): string | undefined {
  return error instanceof ApiError && error.requestId
    ? `Référence de diagnostic : ${error.requestId}`
    : undefined;
}

/**
 * Orchestration volontairement courte des états d'une zone asynchrone.
 * Les pages gardent leurs requêtes et leur mise en page : seules les cinq
 * sorties visibles (chargement, erreur, vide, contenu, retry) sont alignées.
 */
export function AsyncState({
  pending,
  error,
  empty,
  loading,
  children,
  errorTitle,
  errorMessage,
  onRetry,
  retrying = false,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  compact = false,
}: {
  pending: boolean;
  error: unknown | null;
  empty: boolean;
  loading: ReactNode;
  children: ReactNode;
  errorTitle?: ReactNode;
  errorMessage: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  emptyIcon: ReactNode;
  emptyTitle: ReactNode;
  emptyDescription: ReactNode;
  emptyAction?: ReactNode;
  compact?: boolean;
}) {
  if (pending) return loading;
  if (error) {
    return (
      <ErrorCard
        title={errorTitle}
        message={errorMessage}
        detail={safeErrorReference(error)}
        onRetry={onRetry}
        retrying={retrying}
        compact={compact}
      />
    );
  }
  if (empty) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        compact={compact}
      />
    );
  }
  return children;
}
