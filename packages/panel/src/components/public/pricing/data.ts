import type { PlanId } from "../../../lib/plans.js";

/*
 * Données de la page pricing (M4) — chunk LAZY (route publique), hors bundle
 * initial. Matrice de comparatif issue de 05-plans-and-commercial-strategy.md.
 * AUCUN prix (décision D1 ouverte) ; aucune remise chiffrée (D2 ouverte).
 */

export type BillingPeriod = "monthly" | "annual";

export const BILLING_PERIODS: readonly { value: BillingPeriod; label: string }[] = [
  { value: "monthly", label: "Mensuel" },
  { value: "annual", label: "Annuel" },
];

export function billingPeriodNote(period: BillingPeriod): string {
  return period === "annual" ? "Facturation annuelle" : "Facturation mensuelle";
}

export interface ComparisonRow {
  readonly label: string;
  readonly values: Readonly<Record<PlanId, string>>;
}

/** Comparatif fonctionnalités × offres (granularité de communication, pas la spec technique). */
export const PLAN_COMPARISON: readonly ComparisonRow[] = [
  { label: "Serveurs (emplacements)", values: { free: "1", premium: "3", business: "5" } },
  { label: "Modération", values: { free: "Essentielle", premium: "Avancée", business: "Maximale" } },
  { label: "Auto-mod", values: { free: "Basique", premium: "Renforcé", business: "Complet" } },
  { label: "Musique", values: { free: "Base", premium: "Avancée", business: "Complète" } },
  { label: "Statistiques", values: { free: "Base", premium: "Détaillées", business: "Complètes" } },
  { label: "Historique / logs", values: { free: "Base", premium: "Étendus", business: "Complets" } },
  { label: "Automatisations", values: { free: "Essentielles", premium: "Supplémentaires", business: "Complètes" } },
  { label: "Personnalisation", values: { free: "Limitée", premium: "Poussée", business: "Maximale" } },
  { label: "Outils d'équipe", values: { free: "—", premium: "Partiel", business: "Oui" } },
  { label: "Support", values: { free: "Standard", premium: "Prioritaire", business: "Ultra-prioritaire" } },
];

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

/* FAQ d'objections — réponses véridiques, sans prix, sans fausse promesse. */
export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "Puis-je commencer gratuitement ?",
    answer: "Oui. L'offre Gratuit permet d'utiliser Archodev sur un serveur, sans carte bancaire.",
  },
  {
    question: "Les tarifs sont-ils déjà fixés ?",
    answer: "Pas encore. Les prix des offres Premium et Business seront annoncés prochainement.",
  },
  {
    question: "Puis-je changer d'offre à tout moment ?",
    answer: "Oui, vous pourrez faire évoluer votre offre selon vos besoins ; votre configuration est conservée.",
  },
  {
    question: "Que se passe-t-il si je repasse à une offre inférieure ?",
    answer: "Vos serveurs excédentaires sont mis en pause sans suppression : la configuration est préservée et réactivable plus tard.",
  },
  {
    question: "« Toutes les fonctionnalités », qu'est-ce que cela comprend ?",
    answer: "Les fonctions destinées aux utilisateurs. Les outils internes d'exploitation ne font jamais partie d'une offre client.",
  },
  {
    question: "Mes données sont-elles isolées ?",
    answer: "Oui. Chaque serveur est isolé et vous gardez le contrôle de chaque permission.",
  },
];
