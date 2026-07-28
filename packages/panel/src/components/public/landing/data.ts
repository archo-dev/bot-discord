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
  {
    icon: "bolt",
    title: "Tout centralisé",
    description: "Retrouvez réglages, modules et actions essentielles dans une interface unique.",
  },
  {
    icon: "shield",
    title: "Communauté plus saine",
    description: "Gardez la modération, les alertes et les outils communautaires faciles à piloter.",
  },
  {
    icon: "chart",
    title: "Statistiques en temps réel",
    description: "Lisez l’activité et la santé du serveur depuis des indicateurs immédiatement compréhensibles.",
  },
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
