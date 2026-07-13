# Milestone 10 — Studio d’automatisations Discord

## 1. Résumé

Étendre le moteur conditions/actions des commandes personnalisées en workflows visuels déclenchés par événements ou horaires, avec templates, simulation, limites, journal, idempotence et coupe-circuit.

## 2. Problème et preuves

- Le projet possède déjà logique typée, conditions, actions, variables, cooldowns et révisions pour commandes.
- Cette puissance n’est pas disponible pour événements Gateway ou horaires.
- YAGPDB démontre la valeur des custom commands avancées et leur difficulté d’apprentissage.
- Sans scheduler, livraison fiable et observabilité, l’automatisation augmenterait le risque de spam/boucles.

## 3. Valeur utilisateur

Adapter le bot à des besoins variés sans code, intégrations payantes ni multiplication de bots.

## 4. Valeur technique

Unifier commandes, événements et tâches autour d’un moteur versionné ; réutiliser actions existantes et réduire modules spécialisés.

## 5. Comparaison concurrentielle

YAGPDB offre puissance mais complexité ; MEE6 Automations simplifie avec limites commerciales ; Carl-bot tags/triggers couvre des scénarios. Différenciation : éditeur clair, simulation, sécurité et quota gratuit transparent.

## 6. Architecture proposée

- Workflow : trigger versionné, conditions pures, actions ordonnées, cooldown/quota, état et révision.
- Triggers v1 : membre rejoint, niveau atteint, ticket créé, horaire ; message reçu seulement après revue intents/politique.
- Runtime commun pur pour validation/conditions ; adaptateurs Worker/Gateway/scheduler.
- C2.0 `scheduled_tasks` avec lease/idempotence/retry/purge.
- Contexte minimal, variables allowlistées, graphe sans boucle v1.
- Dry-run/simulation sur données synthétiques ou contexte fourni, jamais replay de contenu privé.
- Journal résultat agrégé et coupe-circuit automatique après erreurs/spam.

## 7. Packages, modules et fichiers concernés

Shared command-logic/variables et nouveaux workflow types. Worker engine/actions/conditions/cooldown, cron/internal/API/queries. Gateway events/config cache/worker-api. Panel éditeur command/workflow, combobox, savebar. Migrations/tests.

## 8. Routes API concernées

- CRUD `/api/guilds/:id/workflows`, état, révisions, simulation.
- Endpoint interne batch d’événements via M5.
- Scheduler interne non public.
- Quotas et permissions M2/M3.

## 9. Tables et migrations D1 éventuelles

`workflows`, `workflow_revisions`, agrégats d’exécution et `scheduled_tasks`. Index guilde/trigger/enabled et due/status. Payloads Zod versionnés, taille/compte bornés. Purge historique.

## 10. Modifications Gateway

Mapper événements autorisés vers enveloppes M5 ; ne jamais exécuter de logique D1 localement. Cache abonnement triggers pour éviter événements inutiles. Respect intents et feature flags.

## 11. Modifications Worker

Généraliser moteur pur, scheduler, orchestrateur, validations permissions/actions, idempotence, cooldowns, quotas, revisions et circuit breaker.

## 12. Modifications panel

Liste/templates, éditeur progressif trigger → conditions → actions, aperçu des permissions, test, historique et erreurs localisées. Mode expert secondaire ; mobile permet consultation/toggle mais édition complexe peut recommander desktop.

## 13. Sécurité et permissions

Admin-only édition ; actions allowlistées ; URL webhook restreinte/SSRF auditée ou exclue v1 ; limites mentions ; protection boucles et fan-out ; intents minimaux ; secrets jamais variables ; audit complet.

## 14. Performance et montée en charge

Préfiltrer triggers Gateway, batch M5, index par trigger, limite workflows/actions/fréquence, timeout exécution, pas de recursion, scheduler lots/lease. Quotas gratuits configurables via M3.

## 15. Risques

Spam, boucle, actions dupliquées, langage trop complexe, scheduler concurrent, migrations du moteur commande, SSRF webhook, intents MessageContent et support élevé.

## 16. Dépendances

Toutes les fondations A, M5, M7, M8. C2.0 scheduler obligatoire. Les tickets C1 peuvent fournir un trigger mais ne sont pas requis pour le noyau.

## 17. Développement par phases

1. Cadrage triggers/actions/limites et extraction moteur pur.
2. C2.0 scheduler autonome, rappel comme preuve.
3. CRUD workflows/révisions sans exécution.
4. Trigger membre rejoint + actions sans risque.
5. Gateway/M5 et autres triggers.
6. Éditeur/templates/simulation.
7. Circuit breaker, quotas, pilotes.

Si C2.0 >5–7 j, branche/déploiement séparés obligatoires avant la suite.

## 18. Tests

Property tests conditions, schémas/version, scheduler concurrence/restart/retard, idempotence, boucle/fan-out, permissions, SSRF, quotas, ancien moteur commandes, simulation, compatibilité Gateway et end-to-end pilotes.

## 19. Rollback

Workflows off par défaut, activation par guilde pilote, coupe-circuit global/module/workflow. Moteur commandes actuel conservé via adaptateur. Scheduler peut être stoppé sans perdre tasks ; migrations additives.

## 20. Indicateurs de réussite

- ≥30 % des serveurs pilotes créent un workflow utile.
- ≥99 % d’exécutions réussies hors refus Discord attendus.
- Zéro boucle non bornée ou double action sur tests/pilotes.

## 21. Estimation détaillée

Conception 3–5 j ; développement 9–15 j ; tests 4–6 j ; docs 2–4 j ; total 18–30 j hors extraction autonome C2.0. Rallonges : scheduler, refactor moteur, webhook et UX éditeur.

## 22. Documentation

Concepts, triggers/actions/variables, limites, templates, sécurité, scheduler, erreurs, runbook circuit breaker, ajout d’un trigger/action et migration versions.

## 23. Passation à Claude

Claude doit traiter C2.0 comme un produit de fiabilité, pas un simple cron. Commencer avec un trigger et trois actions sûres. Aucun MessageContent ou webhook avant audit/validation spécifique.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Implémente « Studio d’automatisations Discord » selon docs/milestone-codex/10-studio-automatisations.md uniquement après validation des gates A/B, M5/M7/M8. Crée milestone/automation-studio depuis master propre et un point de restauration.

Avant code, audite le moteur commandes existant, événements Gateway, intents, actions, cooldowns et cron. Propose v1 avec un seul trigger événementiel, un trigger horaire et trois actions sûres, quotas et modèle versionné. Évalue C2.0 scheduled_tasks : si >5–7 jours ou migration substantielle, arrête et propose une branche/milestone autonome déployée séparément.

Commits : extraction moteur pur, scheduler/rappel, CRUD/révisions, exécution premier trigger, intégration Gateway M5, éditeur/simulation, circuit breaker/pilotes. Aucun graphe cyclique, payload libre, secret variable, MessageContent ou webhook sans validation sécurité dédiée. Worker seul écrivain D1 ; idempotence et limites obligatoires. Migrations additives/locales/réversibles, aucune remote sans accord.

Tests property, scheduler restart/concurrence, idempotence, spam/loop/SSRF/permissions, compatibilité commandes et end-to-end. Check/tests/build, documentation, rollback/coupe-circuit. Aucun déploiement automatique.
```
