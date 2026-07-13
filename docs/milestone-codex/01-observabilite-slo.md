# Milestone 1 — Observabilité, SLO et diagnostic par serveur

## 1. Résumé

Construire une couche d’observabilité gratuite et proportionnée : logs JSON corrélés, métriques agrégées, santé Worker/Gateway, quelques SLO et une vue de diagnostic réservée aux administrateurs. Aucun contenu de message ni service externe payant.

## 2. Problème et preuves

- Le Worker et le Gateway utilisent principalement `console.log/error` sans schéma commun.
- Les appels internes n’échangent pas d’identifiant de corrélation.
- Le heartbeat prouve seulement une présence récente ; il ne décrit pas files, erreurs ou version.
- Le buffer vocal abandonne un lot après échec, sans compteur durable.
- Les métriques Cloudflare et VPS n’étaient pas accessibles pendant l’audit : la baseline doit être créée avant de fixer les seuils.

## 3. Valeur utilisateur

- Afficher un état compréhensible par module au lieu d’un échec générique.
- Réduire le délai de résolution des commandes, logs ou musique indisponibles.
- Donner au support une référence d’incident sans demander de données privées.

## 4. Valeur technique

- Distinguer Discord, réseau, Worker, D1 et Gateway.
- Mesurer les optimisations et les régressions.
- Fournir les garde-fous opérationnels de toutes les milestones suivantes.

## 5. Comparaison concurrentielle

Ticket Tool expose documentation de dépannage et page de statut ; Dyno publie guides et releases. L’avantage recherché n’est pas une console complexe, mais un diagnostic par serveur plus transparent que les messages « réessayez » habituels.

## 6. Architecture proposée

- Bibliothèque partagée de contexte : `requestId`, `operation`, `guildHash`, `module`, `durationMs`, `outcome`, `errorCode`, `version`.
- Hash rotatif ou pseudonyme non réversible pour les identifiants dans les agrégats ; ID brut uniquement dans les logs restreints lorsqu’indispensable.
- Compteurs horaires/journaliers bornés dans D1 ; état éphémère Gateway dans KV.
- Enveloppe de log JSON commune, sans token, contenu, URL sensible ni payload libre.
- SLO initiaux : disponibilité API panel, succès interactions, fraîcheur heartbeat, latence p95 lecture et taux de perte de file.
- Endpoint admin diagnostic et page panel ; aucune métrique publique détaillée au départ.

## 7. Packages, modules et fichiers concernés

- `packages/shared/src/` : types télémétrie et codes d’opération.
- `packages/worker/src/index.ts`, `ratelimit.ts`, `discord/rest.ts`, `internal/*`, `cron.ts`.
- `packages/gateway/src/worker-api.ts`, `events.ts`, `http.ts`, `util.ts`.
- `packages/panel/src/pages/` et `ui/` pour la santé.
- `packages/worker/test/` pour confidentialité et agrégats.

## 8. Routes API concernées

- Nouveau `GET /api/guilds/:guildId/health`, protégé par l’accès panel.
- Nouveaux endpoints internes de heartbeat enrichi et éventuellement agrégats en lots.
- `GET /health` limité à un statut global non sensible.
- Aucun changement de contrat métier des routes existantes.

## 9. Tables et migrations D1 éventuelles

Migration additive probable :

- `operation_metrics(guild_id_hash, bucket, module, operation, outcome, count, duration_sum, duration_max)` ;
- index unique sur clé d’agrégat ;
- rétention 30–90 jours via cron.

Éviter une table « un log par événement » dans D1. Tester volume et `UPSERT` avant remote.

## 10. Modifications Gateway

- Ajouter contexte/version aux appels internes.
- Compter files, retries, erreurs Discord, ping et mémoire process agrégée.
- Enrichir heartbeat sans données utilisateurs.
- Produire des logs JSON et conserver une sortie humaine en développement.

## 11. Modifications Worker

- Middleware durée/corrélation.
- Classification stable des erreurs.
- Agrégation non bloquante avec `waitUntil` quand acceptable.
- Endpoint santé, purge et limites de cardinalité.

## 12. Modifications panel

- Carte santé par module : opérationnel, dégradé, inactif, prérequis manquant.
- Copier un identifiant de diagnostic non sensible.
- États loading/vide/erreur et texte orienté action.

## 13. Sécurité et permissions

- Santé détaillée : administrateurs seulement ; modérateurs voient au plus l’état fonctionnel.
- Liste de champs autorisés, jamais de sérialisation brute d’exception/request.
- Rétention et accès documentés ; tests anti-secret et anti-PII.
- Ne pas exposer topologie interne, tokens, IP ou noms de machine.

## 14. Performance et montée en charge

- Agrégation en mémoire/KV puis batch D1 ; dimensions finies.
- Échantillonnage des succès si volume, jamais des erreurs critiques.
- Budget d’instrumentation : <2 % de latence p95 et écritures bornées par bucket.

## 15. Risques

- Cardinalité D1 incontrôlée.
- Fausse précision avec peu de serveurs.
- Données privées introduites par une exception.
- Page santé elle-même indisponible pendant un incident.

## 16. Dépendances

Première milestone. Elle alimente sécurité, performance, livraison fiable et analytics, mais reste strictement séparée des analytics produit.

## 17. Développement par phases

1. Inventaire opérations/données interdites et baseline.
2. Types et logger structuré sans persistance.
3. Corrélation Worker/Gateway et heartbeat enrichi.
4. Agrégats D1/KV et purge.
5. Route et panel santé.
6. SLO, alertes manuelles et documentation.

## 18. Tests

- Unitaires : redaction, classification, agrégation, buckets.
- Worker : permissions, isolation guilde, migration/purge.
- Gateway : retry/heartbeat avec fetch simulé.
- Panel : rendu des quatre états et accessibilité.
- Test de charge local comparatif avant/après.

## 19. Rollback

- Feature flag interne pour couper persistance et page santé.
- Code compatible sans nouvelle table jusqu’à migration confirmée.
- Rollback applicatif avant suppression éventuelle ; table conservée puis retirée dans une migration ultérieure explicitement autorisée.

## 20. Indicateurs de réussite

- ≥95 % des erreurs corrélables à un module et une opération.
- Temps médian de diagnostic d’un scénario connu <15 minutes.
- Surcoût p95 de l’instrumentation <2 %.

## 21. Estimation détaillée

- Audit/conception : 1–2 j.
- Développement : 4–6 j.
- Tests/corrections : 2–3 j.
- Documentation/passation : 1–2 j.
- Total : 8–13 j assistés, hors attente d’observation. Rallonges : accès métriques, cardinalité et exigences de confidentialité.

## 22. Documentation

Schéma des événements, dictionnaire de codes, SLO, runbooks, politique de rétention, procédure d’ajout d’une opération et guide de diagnostic support.

## 23. Passation à Claude

Claude doit commencer par mesurer l’existant et proposer une taxonomie finie. Il ne doit pas journaliser de payload brut, installer de SaaS, ni créer une plateforme d’alerting surdimensionnée. Toute migration et tout déploiement nécessitent validation séparée.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Tu implémentes la milestone « Observabilité, SLO et diagnostic par serveur » du projet botdiscord.

Avant tout changement, lis CLAUDE.md, docs/milestone-codex/01-observabilite-slo.md et l’architecture actuelle. Vérifie master propre, crée une branche milestone/observability-slo et un point de restauration. Audite les logs, erreurs, routes et volumes ; présente un plan et une taxonomie de champs autorisés/interdits avant de coder.

Contraintes : aucun SaaS payant, aucun contenu de message, token, payload brut ou donnée personnelle dans la télémétrie ; Worker seul écrivain D1 ; isolation par guildId ; dimensions bornées ; compatibilité avec l’ancien schéma. Implémente par phases avec commits distincts : types/logger, corrélation, heartbeat, agrégats/purge, API santé, panel. Toute migration doit être additive, testée localement, réversible et ne jamais être appliquée à distance sans validation explicite.

Ajoute tests Worker, Gateway et panel proportionnés, redaction/anti-secret, tests permissions/isolation, typecheck, build et mesure du surcoût. Documente SLO, rétention, runbooks et rollback. Ne déploie pas. À la fin, fournis fichiers modifiés, commits, résultats exacts et décisions ouvertes.
```
