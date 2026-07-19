# 05 — Offres & stratégie commerciale

> Voir aussi : [plateforme client](./03-client-platform.md) · [abonnements](./06-subscriptions-and-entitlements.md) · [décisions ouvertes](./13-open-decisions.md)

> ⚠️ **Aucun prix n'est décidé dans ce document.** Les montants sont à arbitrer en [13-open-decisions.md](./13-open-decisions.md) après analyse. Ci-dessous : positionnement, promesses, bénéfices, textes et mécaniques de conversion.

## Principe : vendre des résultats, pas une liste technique

La communication met en avant ce que le client **obtient** : gagner du temps, automatiser les tâches répétitives, protéger la communauté, réduire les incidents, professionnaliser le serveur, mieux comprendre son activité, centraliser plusieurs serveurs, obtenir de l'aide plus vite.

**Phrase directrice :** « Gratuit vous aide à démarrer. Premium vous fait gagner du temps. Business vous donne le contrôle total. »

## Les trois offres

### Gratuit — « Pour commencer sereinement »

**Promesse :** tout ce qu'il faut pour lancer, protéger et organiser une première communauté sans abonnement.

**Inclus (limites) :**
- 1 serveur ;
- modération essentielle ;
- Auto-mod basique ;
- musique et logs de base ;
- outils communautaires essentiels ;
- accès au panel ;
- support standard (non prioritaire).

**Bénéfices vendus :** démarrer gratuitement · mieux organiser son serveur · automatiser les tâches essentielles · une base sérieuse sans paiement.

### Premium — « Pour développer votre communauté »

**Promesse :** passez moins de temps à gérer et davantage de temps à faire grandir votre communauté.

**Inclus (limites) :**
- jusqu'à 3 serveurs ;
- tout le plan Gratuit ;
- panel de fonctionnalités beaucoup plus large ;
- modération avancée, Auto-mod renforcé ;
- musique avancée ;
- statistiques détaillées, historique & logs étendus ;
- automatisations supplémentaires, personnalisation plus poussée ;
- support prioritaire.

**Bénéfices vendus :** gain de temps quotidien · moins de tâches manuelles · meilleure protection · expérience plus professionnelle pour les membres · meilleure visibilité sur l'activité · aide plus rapide.

### Business — « Pour gérer sans compromis »

**Promesse :** toute la puissance d'Archodev pour les communautés ambitieuses et les réseaux de serveurs.

**Inclus (limites) :**
- jusqu'à 5 serveurs ;
- **toutes les fonctionnalités utilisateur** ;
- limites maximales, automatisations complètes ;
- statistiques complètes, personnalisation maximale ;
- outils de gestion pour les équipes ;
- support ultra-prioritaire.

**Bénéfices vendus :** gestion centralisée de plusieurs communautés · contrôle maximal · moins d'erreurs humaines · exploitation plus professionnelle · toutes les capacités disponibles · support le plus élevé.

> **Important :** « toutes les fonctionnalités » = toutes les fonctions **utilisateur**. Les outils du Studio, diagnostics globaux, gestion de plateforme et actions développeur **ne font jamais partie** d'un abonnement client.

## Comparatif (structure de la page `/pricing`)

| | Gratuit | Premium | Business |
|---|---------|---------|----------|
| Positionnement | Commencer sereinement | Développer votre communauté | Gérer sans compromis |
| Serveurs (emplacements) | 1 | 3 | 5 |
| Modération | Essentielle | Avancée | Maximale |
| Auto-mod | Basique | Renforcé | Complet |
| Musique | Base | Avancée | Complète |
| Statistiques | Base | Détaillées | Complètes |
| Historique / logs | Base | Étendus | Complets |
| Automatisations | Essentielles | Supplémentaires | Complètes |
| Personnalisation | Limitée | Poussée | Maximale |
| Outils d'équipe | — | Partiel | Oui |
| Support | Standard | Prioritaire | Ultra-prioritaire |
| Prix | **[à définir — doc 13]** | **[à définir]** | **[à définir]** |

> Le **mapping précis** feature → offre (quelle capacité exacte dans quel plan) est une **décision produit ouverte** ([doc 13](./13-open-decisions.md)). Le tableau ci-dessus donne la granularité de communication, pas la spécification technique finale.

## Textes commerciaux (propositions — à ajuster)

**Titres de hero (options) :**
- « Gérez votre communauté Discord comme un pro. »
- « Moins de gestion. Plus de communauté. »
- « Le bot qui anime, protège et gère votre serveur — sans effort. »

**Sous-titres :**
- « Modération, animation, statistiques et automatisations réunies dans un panel clair. Gratuit pour commencer. »
- « Automatisez les tâches répétitives, protégez vos membres, gagnez du temps chaque jour. »

**CTA :**
- Primaire public : « Commencer gratuitement » / « Ajouter à mon serveur ».
- Secondaire : « Voir les tarifs » / « Se connecter avec Discord ».
- Upsell panel : « Passer à Premium » / « Débloquer avec Premium » / « Comparer les offres ».

**Arguments (blocs de landing, orientés bénéfice) :**
1. **Gagnez du temps** — l'automatisation prend en charge les tâches répétitives.
2. **Protégez votre communauté** — auto-mod et modération réduisent les incidents.
3. **Professionnalisez votre serveur** — accueil, rôles, niveaux, tickets soignés.
4. **Comprenez votre activité** — statistiques claires et historique.
5. **Centralisez vos serveurs** — plusieurs communautés, un seul panel (Premium/Business).
6. **Obtenez de l'aide plus vite** — support priorisé selon votre plan.

**Sections de landing suggérées :** hero → preuve de valeur (résultats) → « comment ça marche » (3 étapes) → aperçu des offres → modules par bénéfice → témoignages/réassurance **[à produire]** → dernières mises à jour → FAQ → CTA final.

## Upsells dans le panel (non frustrants)

- **Contextuels** : l'invite apparaît quand l'utilisateur atteint une limite (ex. 2e serveur en Gratuit, module avancé verrouillé), pas en pop-up aléatoire.
- **Message orienté gain** : « Débloquez la modération avancée et gagnez du temps » plutôt que « Fonction payante ».
- **Comparaison rapide** accessible en un clic (`/pricing` ou modale de comparaison).
- **Fréquence maîtrisée** : pas de répétition harcelante ; un rappel discret et persistant vaut mieux qu'un pop-up.

## Verrouillage visuel d'une fonction Premium sans dégrader l'UX

(Complète [doc 03](./03-client-platform.md) §verrouillage et [doc 10](./10-ux-ui-direction.md).)

- La fonction reste **visible et compréhensible** : aperçu lisible, badge « Premium » discret, contrôles désactivés avec libellé clair.
- CTA doux intégré (« Débloquer avec Premium ») menant à `/app/subscription`.
- **Pas de mur opaque, pas d'erreur brutale** : on montre la valeur pour donner envie.
- Application réelle **backend** : le Worker refuse la mutation hors plan (le verrouillage visuel n'est jamais la seule barrière).

## Points de conversion à instrumenter

- Vue `/pricing`, clic CTA, ajout du bot, connexion, atteinte d'une limite, ouverture d'un upsell, passage au paiement, complétion d'achat, downgrade.
- Réutilise l'infrastructure d'analytics produit existante (`product_metrics*`, `packages/worker/src/analytics/`) dans le respect de `docs/privacy-analytics.md`.

## Positionnement vs marché

Inspirations (structure produit, **sans copie**) : Linear, Vercel, Stripe, Discord, DraftBot (structure d'offres bot Discord), meilleurs dashboards SaaS. Différenciateurs à mettre en avant : cohérence marque public↔panel, transparence (statut, mises à jour), support priorisé, automatisations. **[Hypothèse]** : le positionnement prix devra être calibré face à DraftBot/MEE6/Dyno Premium (analyse concurrentielle à mener — [doc 13](./13-open-decisions.md)).

## Séparation décision produit / UX / commerciale

- **Produit** : 3 plans (1/3/5 serveurs), périmètre features par plan (**à finaliser**).
- **Commercial** : promesses, bénéfices, textes, CTA, comparatif, positionnement (**prix à définir**).
- **UX** : upsells contextuels, verrouillage non frustrant, comparatif clair.
