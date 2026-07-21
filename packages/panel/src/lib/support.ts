/*
 * Helpers PURS de l'espace support (M11) — aucune dépendance React/DOM,
 * testables en node. La priorité et l'état viennent du backend (jamais du
 * client) ; ces helpers ne font que formater.
 */
import type { SupportMessageAuthor, SupportPriority, SupportTicketStatus } from "@bot/shared";

export function supportPriorityLabel(priority: SupportPriority): string {
  return priority === "high" ? "Priorité maximale" : priority === "normal" ? "Priorité élevée" : "Priorité standard";
}

export function supportStatusLabel(status: SupportTicketStatus): string {
  switch (status) {
    case "open":
      return "Ouvert";
    case "pending":
      return "En attente";
    case "resolved":
      return "Résolu";
    case "closed":
      return "Fermé";
  }
}

export function supportAuthorLabel(author: SupportMessageAuthor): string {
  return author === "user" ? "Vous" : author === "operator" ? "Support" : "Système";
}
