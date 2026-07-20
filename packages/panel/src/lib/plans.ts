/*
 * Catalogue PRÉSENTIEL des offres (M3) — données marketing uniquement.
 *
 * PAS de logique de facturation, PAS de prix (les montants sont une décision
 * ouverte, cf. E7/D1). Identifiants techniques stables `free|premium|business`
 * (cohérents avec le futur modèle d'entitlements M6). Réutilisé par la landing
 * (M3) et la page pricing (M4). Positionnements, slots et niveaux de support
 * validés (cf. docs/platform-split/05-plans-and-commercial-strategy.md).
 */

export type PlanId = "free" | "premium" | "business";

export interface PlanTier {
  readonly id: PlanId;
  readonly name: string;
  readonly tagline: string;
  /** Nombre de serveurs (emplacements) — 1 / 3 / 5. */
  readonly servers: number;
  readonly support: string;
  /** Offre mise en avant visuellement (décision validée : Premium). */
  readonly highlighted: boolean;
  /** Bénéfices qualitatifs — aucun chiffre inventé. */
  readonly benefits: readonly string[];
}

export const PLAN_TIERS: readonly PlanTier[] = [
  {
    id: "free",
    name: "Gratuit",
    tagline: "Pour commencer sereinement",
    servers: 1,
    support: "Support standard",
    highlighted: false,
    benefits: [
      "Modération essentielle et auto-mod de base",
      "Musique et logs de base",
      "Outils communautaires essentiels",
      "Accès au panel web",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    tagline: "Pour développer votre communauté",
    servers: 3,
    support: "Support prioritaire",
    highlighted: true,
    benefits: [
      "Modération avancée, auto-mod renforcé",
      "Musique avancée et personnalisation poussée",
      "Statistiques détaillées, historique étendu",
      "Automatisations supplémentaires",
    ],
  },
  {
    id: "business",
    name: "Business",
    tagline: "Pour gérer sans compromis",
    servers: 5,
    support: "Support ultra-prioritaire",
    highlighted: false,
    benefits: [
      "Toutes les fonctionnalités utilisateur",
      "Limites maximales, automatisations complètes",
      "Gestion centralisée de plusieurs serveurs",
      "Outils de gestion pour les équipes",
    ],
  },
];

/** Phrase directrice commerciale (validée). */
export const PLANS_DIRECTIVE = "Gratuit vous aide à démarrer. Premium vous fait gagner du temps. Business vous donne le contrôle total.";

/** Libellé « N serveur(s) ». */
export function serversLabel(count: number): string {
  return count <= 1 ? "1 serveur" : `${count} serveurs`;
}
