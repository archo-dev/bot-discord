# Roadmap validée — préparation à l’ouverture publique

## Règle d’exécution

> **Une seule milestone majeure doit être développée à la fois.** Chaque milestone dispose de sa propre branche, d’un point de restauration, de commits par phase, de validations complètes et d’un déploiement séparé et observé avant de commencer la suivante.

Une milestone n’est considérée terminée qu’après :

1. validation de son plan et de son périmètre ;
2. migrations locales puis distantes explicitement autorisées, si nécessaires ;
3. typecheck, tests et build ;
4. documentation et procédure de rollback ;
5. déploiement indépendant ;
6. fenêtre d’observation avec critères de succès ;
7. décision humaine de poursuivre.

Les estimations supposent un développement assisté par Codex ou Claude avec validation humaine. Elles ne doivent pas être additionnées comme un calendrier garanti : les retours de production peuvent imposer une pause.

## Ordre retenu

L’ordre demandé est techniquement cohérent. Deux précisions sont apportées :

- la gouvernance des modules précède l’onboarding, car le centre des modules doit consommer un contrat stable plutôt que reconstruire ses propres règles ;
- le socle de tâches planifiées du backlog devient une **sous-phase obligatoire de conception et d’infrastructure de la milestone 10**, mais son moteur minimal peut être livré séparément juste avant le studio si sa taille dépasse 5–7 jours.

## Phase A — Fondations

### A1. Observabilité, SLO et diagnostic par serveur

**Durée :** 8–13 jours. **Objectif :** rendre l’état réel du système mesurable avant toute optimisation ou ouverture.

Livrables de sortie : logs structurés, corrélation, métriques bornées, santé Gateway/Worker, premiers SLO et page de diagnostic restreinte.

Débloque : A2, A4, B1, B4 et la mesure de toutes les milestones suivantes.

### A2. Socle de sécurité publique multi-tenant

**Durée :** 8–14 jours. **Objectif :** formaliser les frontières de confiance, permissions minimales, quotas et preuves d’isolation.

Livrables de sortie : threat model, matrice de permissions, audit des routes, durcissement sessions/interne, tests IDOR et préparation administrative Discord.

Débloque : l’ouverture à des administrateurs inconnus, B2, B3, B4 et C1/C2.

### A3. Gouvernance des modules et capacités

**Durée :** 8–14 jours. **Objectif :** fournir une source de vérité partagée pour modules, dépendances, prérequis, santé et quotas.

Livrables de sortie : registre typé, DTO d’état, règles d’activation, version de configuration, modèle d’entitlements neutre.

Débloque : B2, B3, C1, C2 et une évolution freemium sans logique dispersée.

### A4. Budgets performance et coût

**Durée :** 7–12 jours. **Objectif :** établir puis respecter des budgets p95, D1, Discord REST et bundle.

Livrables de sortie : profil de référence, budgets, lazy loading du panel, requêtes/index prouvés, stratégie cache/rate limit.

Débloque : seuils de capacité pour B1 et C2. Cette milestone utilise les mesures de A1 et le registre de A3 pour attribuer les coûts aux modules.

### Gate de sortie A

- SLO observables et tableaux sans contenu privé.
- Tests d’isolation multi-tenant verts.
- Tous les modules actuels décrits par le registre.
- Budgets documentés et aucune régression p95/bundle majeure.
- Go/no-go humain avant la phase B.

## Phase B — Fiabilité et croissance

### B1. Livraison fiable Gateway vers Worker

**Durée :** 11–18 jours. **Objectif :** éviter les pertes silencieuses pendant les coupures réseau/Worker.

Livrables de sortie : enveloppe d’événement versionnée, idempotence, retry/jitter, file locale bornée, dead-letter et observabilité.

Dépend de : A1 pour mesurer, A2 pour authentifier et A4 pour borner les ressources.

### B2. Onboarding guidé et centre des modules

**Durée :** 9–15 jours. **Objectif :** convertir une invitation en configuration utile en moins de dix minutes.

Livrables de sortie : page publique, lien d’invitation expliqué, checklist, presets, diagnostics de prérequis et centre des modules.

Dépend de : A2 pour les permissions et A3 pour le contrat des modules. Peut commencer en parallèle de l’observation post-déploiement de B1, mais pas être développé simultanément.

### B3. Sauvegarde, restauration et journal de configuration

**Durée :** 8–14 jours. **Objectif :** rendre les changements administratifs réversibles et transférables.

Livrables de sortie : snapshots versionnés, diff, restauration sélective, export/import validés et remappage d’entités Discord.

Dépend de : A2 pour l’audit, A3 pour versionner les modules et B2 pour intégrer le parcours sans le complexifier.

### B4. Analytics produit respectueuses de la vie privée

**Durée :** 6–11 jours. **Objectif :** mesurer adoption, réussite de configuration et désinstallation sans contenu ni profilage individuel.

Livrables de sortie : taxonomie, agrégats journaliers, opt-out, rétention, tableau interne et feedback volontaire.

Dépend de : A1 afin de séparer télémétrie technique et analytics produit, A2 pour la politique de données, B2 pour instrumenter le funnel réel.

### Gate de sortie B

- Simulation de panne de 10 minutes sans perte ni doublon appliqué.
- Parcours d’installation mesurable et documenté.
- Restauration testée sur les modules prioritaires.
- Analytics sans contenu Discord, identifiants bruts ou conservation indéfinie.
- Au moins une fenêtre d’observation sur un groupe de serveurs pilotes.

## Phase C — Fonctionnalités avancées

### C1. Tickets d’équipe avancés

**Durée :** 13–22 jours. **Objectif :** faire du module tickets un outil de triage d’équipe sobre.

Livrables de sortie : formulaires, catégories, assignation, états, priorité simple, rappels, permissions et statistiques agrégées.

Dépend de : A2, A3, B1 et B3. Les rappels utilisent le composant minimal de tâches planifiées prévu pour C2 si celui-ci est déjà disponible ; sinon C1 se limite aux échéances calculées sans scheduler actif.

### C2. Studio d’automatisations Discord

**Durée :** 18–30 jours, hors éventuelle extraction du scheduler. **Objectif :** offrir des workflows visuels sûrs sur le moteur conditions/actions existant.

Dépend de : toutes les fondations A, de B1 pour la fiabilité, B3 pour les révisions/rollback et B4 pour mesurer l’adoption.

#### Sous-phase C2.0 obligatoire — tâches planifiées

La proposition alternative « tâches planifiées, rappels et giveaways » est scindée :

- **moteur générique `scheduled_tasks`** : prérequis de C2, avec verrou, idempotence, reprise et purge ;
- **rappels** : premier cas de validation peu risqué ;
- **giveaways** : reste dans le backlog, car il ajoute règles métier, fraude et support sans être nécessaire au studio.

Si C2.0 dépasse 5–7 jours ou requiert une migration significative, elle devient une milestone autonome entre B4 et C1, avec sa propre branche et son propre déploiement. Elle ne doit pas être cachée dans un gros commit du studio.

### Gate de sortie C

- Tickets sans fuite de permissions et avec politique de transcript claire.
- Scheduler prouvé par redémarrages et exécutions concurrentes.
- Studio borné : nombre de workflows, profondeur, actions, temps et fréquence.
- Coupe-circuit et historique d’exécution disponibles avant ouverture générale.

## Calendrier indicatif

Ce calendrier privilégie la sûreté. Il suppose une personne assistée par IA, avec disponibilité régulière pour les validations.

| Fenêtre | Milestones | Durée indicative avec observation |
|---|---|---:|
| Mois 1 | A1 puis A2 | 4–6 semaines |
| Mois 2 | A3 puis A4 | 4–6 semaines |
| Mois 3 | B1 puis observation | 3–5 semaines |
| Mois 4 | B2 puis B3 | 4–7 semaines |
| Mois 5 | B4, pilotes et consolidation | 2–4 semaines |
| Mois 6+ | C1, C2.0 puis C2 selon demande | 8–16 semaines |

Le bot peut commencer une ouverture publique progressive après le gate A et B1/B2, sans attendre toutes les fonctionnalités avancées.

## Stratégie de branches et versions

Exemples recommandés :

- `milestone/observability-slo`
- `milestone/public-security`
- `milestone/module-governance`
- `milestone/performance-budgets`

Chaque branche part du `master` propre et déployé. Une branche suivante ne part jamais d’une branche non fusionnée. Les migrations suivent : sauvegarde/diagnostic → migration additive → code compatible ancien/nouveau → validation locale → autorisation humaine → remote → déploiement → observation.

## Backlog officiel

Les cinq alternatives sont validées comme backlog, pas comme remplacements. Leur ordre recommandé est :

1. moteur de tâches planifiées/rappels, intégré à C2.0 ;
2. suggestions et votes, après B2/B4 ;
3. FAQ/base de connaissances, après B2 et selon volume de support ;
4. internationalisation, après stabilisation de l’UX ;
5. réputation/saisons, après preuve d’adoption des niveaux.

Voir [alternatives.md](./alternatives.md).
