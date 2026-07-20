import type { IconName } from "../../../ui/icons.js";
import type { ModuleId } from "@bot/shared";

/*
 * Données présentielles de la landing (M3). Bénéfices orientés RÉSULTATS
 * (cf. 05-plans-and-commercial-strategy.md). Aucun chiffre inventé, aucun
 * témoignage, aucune marque concurrente.
 */

export interface Benefit {
  readonly icon: IconName;
  readonly title: string;
  readonly description: string;
}

export const BENEFITS: readonly Benefit[] = [
  { icon: "bolt", title: "Gagnez du temps", description: "L'automatisation prend en charge les tâches répétitives à votre place." },
  { icon: "shield", title: "Protégez votre communauté", description: "Auto-modération et modération réduisent les incidents au quotidien." },
  { icon: "star", title: "Professionnalisez votre serveur", description: "Accueil, rôles, niveaux et tickets soignés dès la première minute." },
  { icon: "chart", title: "Comprenez votre activité", description: "Des statistiques claires et un historique pour piloter votre serveur." },
  { icon: "users", title: "Centralisez vos serveurs", description: "Plusieurs communautés gérées depuis un seul panel (Premium, Business)." },
  { icon: "ticket", title: "Obtenez de l'aide plus vite", description: "Un support priorisé selon votre offre, sans quitter Discord." },
];

export interface UseCase {
  readonly icon: IconName;
  readonly title: string;
  readonly description: string;
}

export const USE_CASES: readonly UseCase[] = [
  { icon: "trophy", title: "Communauté de jeu", description: "Accueil automatique, rôles à la carte, niveaux et modération pour garder un serveur actif et sain." },
  { icon: "mic", title: "Serveur de créateur", description: "Annonces, tickets de support et vocaux temporaires pour accompagner vos membres." },
  { icon: "workflow", title: "Réseau de serveurs", description: "Automatisations et gestion centralisée de plusieurs communautés depuis un seul endroit." },
];

/* Modules mis en avant (registre = source de vérité). Ids éprouvés (M2). */
export const FEATURED_MODULES: readonly ModuleId[] = [
  "welcome",
  "automod",
  "levels",
  "tickets",
  "music",
  "temp_voice",
  "starboard",
  "stats",
];
