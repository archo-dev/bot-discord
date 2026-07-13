# Milestone 4 — Budgets performance et coût

## 1. Résumé

Mesurer puis réduire les coûts qui limiteraient une ouverture publique : latence Worker, appels Discord, écritures D1, cache, mémoire Gateway et bundle panel. Les optimisations sont guidées par M1, avec budgets simples et sans nouvelle infrastructure payante.

## 2. Problème et preuves

- Bundle panel observé : ~988 kB JS (~287 kB gzip), avertissement Vite >500 kB.
- Recharts est chargé dans le bundle principal ; toutes les routes sont importées statiquement.
- Discord REST ne retry qu’une fois sur 429 et Worker/Gateway partagent le quota sans coordination.
- Cache 60 s et index D1 existent, mais aucun p95, ratio cache ou coût par module n’est établi.
- Le limiter KV effectue get+put non atomiques.

## 3. Valeur utilisateur

Panel plus rapide sur mobile, commandes plus régulières et moins d’erreurs lors des pointes.

## 4. Valeur technique

Rester dans les free tiers plus longtemps, connaître la capacité réelle et éviter l’optimisation prématurée.

## 5. Comparaison concurrentielle

Ticket Tool et MEE6 vendent notamment vitesse et expérience dashboard. Le bot peut offrir une expérience sobre et rapide gratuitement, sans promettre une « file premium ».

## 6. Architecture proposée

- Baseline M1 par route/module et budgets versionnés.
- `React.lazy` par page, chunk séparé charts, préchargement après navigation.
- Revue `EXPLAIN QUERY PLAN` des top lectures seulement ; index sur preuve.
- Cache avec coalescence des requêtes concurrentes et invalidation explicite.
- Client Discord commun de politique retry/backoff/jitter et remontée des headers ; coordination minimale par métriques/KV uniquement si prouvée nécessaire.
- Batching des événements et écritures, pagination bornée et payload limits.

## 7. Packages, modules et fichiers concernés

Panel `App.tsx`, pages Stats/Dashboard, charts et Vite. Worker queries, Discord REST, caches et routes chaudes. Gateway config cache, worker-api, voice-xp/stats et mémoire buffers.

## 8. Routes API concernées

Pas de nouvelle route obligatoire. Pagination/ETag possibles sur logs, tickets et statistiques en préservant contrats. Ajouter diagnostics internes uniquement via M1.

## 9. Tables et migrations D1 éventuelles

Seulement après plans d’exécution : index additifs ciblés ou agrégats. Pas d’index « au cas où ». Mesurer coût en écriture et espace.

## 10. Modifications Gateway

Coalescer config misses, borner buffers, mesurer mémoire/loop lag, batcher stats, backoff cohérent et arrêt propre avec flush borné.

## 11. Modifications Worker

Instrumentation D1/Discord, requêtes groupées, cache stampede protection, timeouts, retry 429/5xx idempotent et pagination.

## 12. Modifications panel

Code splitting routes/charts, suppression imports lourds initiaux, cache Query ajusté par nature de donnée, préfetch ciblé et budget Lighthouse/bundle.

## 13. Sécurité et permissions

Les caches restent scellés par guildId/utilisateur. Aucun cache partagé de réponse autorisée sans clé complète. Retry interdit sur mutation non idempotente sans clé.

## 14. Performance et montée en charge

Budgets proposés à valider : JS initial gzip <180 kB, p95 API lecture <500 ms hors Discord, p95 mutation <1 s hors API externe, buffer borné, taux cache config >95 %.

## 15. Risques

Cache périmé, chunking excessif, index ralentissant écritures, retry amplifiant une panne, benchmarks non représentatifs.

## 16. Dépendances

Dépend de M1 pour mesurer et M3 pour coût par module. Précède livraison fiable et studio à volume supérieur.

## 17. Développement par phases

1. Baseline et top 5 goulots.
2. Quick wins panel/chunks.
3. Requêtes D1 et caches prouvés.
4. Politique Discord REST.
5. Gateway buffers/loop.
6. Budgets CI et documentation.

## 18. Tests

Build avec rapport chunks, smoke routes lazy, tests cache/invalidation/concurrence, plans D1, rate-limit Discord simulé, benchmarks reproductibles et non-régression fonctionnelle.

## 19. Rollback

Commits indépendants par optimisation ; feature flags pour cache/retry ; index additifs conservables ; retour import statique si chunk échoue. Ne coupler aucune optimisation à une migration destructive.

## 20. Indicateurs de réussite

- JS initial gzip <180 kB.
- p95 lectures Worker <500 ms sur scénario de référence.
- ≥30 % d’appels Discord redondants en moins sur les parcours ciblés.

## 21. Estimation détaillée

Profilage/conception 2–3 j ; développement 3–5 j ; tests 1–2 j ; documentation 1–2 j ; total 7–12 j. Rallonges : accès production read-only, rate limits difficiles à reproduire et refactor du client REST.

## 22. Documentation

Budgets, méthode benchmark, top routes, stratégie cache, politique retry/idempotence, analyse bundle et guide de revue performance.

## 23. Passation à Claude

Claude ne doit modifier que les goulots mesurés. Chaque optimisation doit inclure mesure avant/après, test et rollback isolé.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Implémente « Budgets performance et coût » après lecture de CLAUDE.md et docs/milestone-codex/04-performance-couts.md. Confirme M1 et M3 disponibles, crée milestone/performance-budgets depuis master propre et un point de restauration.

Avant code, mesure bundle, routes représentatives, appels Discord, requêtes D1 et buffers Gateway avec outils gratuits. Classe les cinq goulots par impact et présente un plan ; aucune optimisation sans baseline. Commits séparés : lazy-loading/charts, requêtes/index prouvés, cache/coalescence, politique Discord retry, buffers Gateway, budgets CI.

Préserve contrats API, isolation guildId et comportement. Retry seulement opérations sûres/idempotentes. Toute migration d’index est additive, expliquée par EXPLAIN, testée localement et jamais remote sans validation. Fournis mesures avant/après, tests de concurrence/cache/rate-limit, check/tests/build et rollback par optimisation. Aucun déploiement.
```
