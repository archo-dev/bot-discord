# Milestone 5 — Livraison fiable Gateway vers Worker

## 1. Résumé

Remplacer les envois « best effort » critiques par une livraison au moins une fois, bornée et idempotente entre Gateway et Worker, sans broker payant ni second écrivain D1.

## 2. Problème et preuves

- Les logs vocaux sont bufferisés puis le lot est abandonné après échec.
- Les appels internes ont timeout mais pas de retry généralisé, file durable ou clé d’idempotence.
- Un redémarrage Gateway perd les buffers mémoire.
- Des doublons seraient dangereux pour XP, compteurs, événements et actions.

## 3. Valeur utilisateur

Historique, XP, statistiques et automatisations cohérents malgré une panne réseau ou un redémarrage.

## 4. Valeur technique

Découplage contrôlé, reprise observable, backpressure et base fiable pour tickets/automation.

## 5. Comparaison concurrentielle

Les grands bots vendent la disponibilité, sans exposer leur mécanique. Une livraison documentée et un statut transparent peuvent devenir un avantage de confiance, sans promettre l’impossible.

## 6. Architecture proposée

- Enveloppe `eventId`, `schemaVersion`, `guildId`, `type`, `occurredAt`, payload validé.
- File append-only locale sur VPS (SQLite ou fichiers segmentés), un seul writer et taille maximale.
- États pending/inflight, lease, tentatives, backoff exponentiel+jitter, dead-letter.
- Worker applique dans transaction ou table d’idempotence avant effet D1.
- ACK explicite après commit ; lots par type/guilde.
- Priorités : actions critiques avant statistiques abandonnables ; politique de perte explicite.

## 7. Packages, modules et fichiers concernés

Gateway `worker-api.ts`, nouveau `outbox/`, voice/stats/xp/starboard/tempvoice. Worker `internal/*`, validation, queries, env. Shared types d’enveloppe. Tests Gateway et Worker.

## 8. Routes API concernées

Préférer un nouvel endpoint versionné `POST /internal/events/batch` ou versionner progressivement les endpoints existants. Conserver anciens endpoints durant transition. ACK contient IDs acceptés/rejetés et codes.

## 9. Tables et migrations D1 éventuelles

- `processed_events(event_id PRIMARY KEY, type, processed_at)` avec purge courte, ou clés idempotentes intégrées aux tables métier.
- Aucun stockage de payload complet après traitement.
- Migration additive et mesure du volume/index.

## 10. Modifications Gateway

- Persistance locale, worker loop, arrêt propre, reprise startup.
- Classification critique/best effort et limites disque.
- Endpoint local de santé de file restreint au Worker/tunnel.

## 11. Modifications Worker

- Validation enveloppe/version, auth interne et limites de lot.
- Transaction/idempotence, réponse partielle et codes retryables/définitifs.
- Purge et métriques M1.

## 12. Modifications panel

Seulement santé : retard, dernière synchronisation, dégradé. Aucun bouton « rejouer » exposé aux admins au départ.

## 13. Sécurité et permissions

Auth interne M2, payload allowlisté, taille maximale, anti-rejeu, séparation guildId et aucune commande arbitraire. Fichiers locaux permissions OS minimales et sans token.

## 14. Performance et montée en charge

Lots ≤50/100, concurrence bornée, flush adaptatif, compression seulement si utile. Quota disque et stratégie drop des métriques non critiques. Pas de requête D1 d’idempotence individuelle si une transaction batch suffit.

## 15. Risques

Doublons, désordre, corruption de file, disque plein, poison event, boucle retry et complexité d’exploitation VPS.

## 16. Dépendances

Requiert M1, M2, M4 ; M3 aide à classifier par module. Précède tickets avancés et studio.

## 17. Développement par phases

1. Classifier événements et garanties.
2. Enveloppe/idempotence Worker sur un type non critique.
3. Outbox locale et reprise.
4. Lots, retry, dead-letter, backpressure.
5. Migrer types critiques progressivement.
6. Santé/runbooks et chaos tests.

## 18. Tests

Panne 10 min, 429/500/timeout, restart à chaque état, doublon, désordre, payload invalide, lot partiel, disque plein simulé, ancien/nouveau protocole et isolation.

## 19. Rollback

Dual-write interdit sauf déduplication prouvée. Basculer type par type via flag ; ancien chemin conservé. Outbox peut être drainée avant retour. Table idempotence conservée durant fenêtre.

## 20. Indicateurs de réussite

- Aucune perte lors d’une panne simulée de 10 min.
- Zéro doublon métier appliqué sur replay.
- File drainée sous 5 min après reprise au volume cible.

## 21. Estimation détaillée

Conception 2–3 j ; développement 5–9 j ; tests 3–4 j ; docs 1–2 j ; total 11–18 j. Rallonges : choix stockage local, transactions par domaine et migration progressive.

## 22. Documentation

Garanties par événement, schéma enveloppe, retry/dead-letter, capacité disque, runbooks panne/replay, compatibilité et procédure de drain.

## 23. Passation à Claude

Claude doit commencer par un seul flux non critique. Il ne doit pas changer la frontière « Worker seul écrivain D1 », installer Kafka/Redis payant ni promettre exactly-once.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Implémente « Livraison fiable Gateway vers Worker » selon docs/milestone-codex/05-livraison-fiable.md. Vérifie que M1, M2 et M4 sont déployées. Depuis master propre, crée milestone/reliable-delivery et un point de restauration.

Avant code, inventorie chaque événement, volume, criticité, tolérance au retard/perte et effet idempotent. Propose stockage outbox local gratuit, enveloppe versionnée, ACK, retry et stratégie dual-protocole. Obtiens validation.

Commence par un flux non critique, puis commits distincts pour enveloppe/Worker idempotent, outbox, retry/dead-letter, migrations de flux, santé. Worker reste seul écrivain D1. Migration additive seulement, test local, backup/rollback, aucune remote sans accord. Teste panne, restart, doublon, désordre, poison event, disque plein, compatibilité. Typecheck/tests/build, runbooks et procédure de drain. Ne déploie pas.
```
