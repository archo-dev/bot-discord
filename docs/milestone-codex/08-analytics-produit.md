# Milestone 8 — Analytics produit respectueuses de la vie privée

## 1. Résumé

Collecter uniquement des événements produit agrégés nécessaires à la décision : installation, progression onboarding, activation module, succès/échec fonctionnel et désinstallation, avec opt-out, rétention et séparation stricte de l’observabilité.

## 2. Problème et preuves

- Aucun taux d’installation, adoption module ou abandon disponible.
- Les choix de roadmap reposent sur code/backlog, pas usage réel.
- L’échelle 10–20 serveurs rend toute statistique fragile ; il faut garder les signaux simples.
- Les logs techniques ne doivent pas devenir un outil de profilage.

## 3. Valeur utilisateur

Le produit évolue selon les difficultés réelles ; feedback possible sans ticket support.

## 4. Valeur technique

Priorisation, suppression de fonctions inutiles, validation onboarding et capacité à dimensionner modules/coûts.

## 5. Comparaison concurrentielle

Les concurrents optimisent fortement leurs funnels et upsells. La différenciation doit être la transparence : analytics minimales, sans contenu, non vendues et désactivables.

## 6. Architecture proposée

- Taxonomie finie : événement, module, étape, résultat, jour, version ; aucune propriété libre.
- Agrégation journalière au niveau guilde pseudonymisée ; pas de parcours utilisateur individuel.
- Séparer tables, code et rétention de M1.
- Opt-out par guilde, documentation et feedback textuel volontaire stocké séparément avec durée courte.
- Dashboard interne simple ; exports agrégés seulement.

## 7. Packages, modules et fichiers concernés

Shared taxonomie ; Worker middleware/service agrégation, cron et routes internes admin ; panel onboarding/modules/feedback ; D1 migrations ; documentation confidentialité.

## 8. Routes API concernées

- `POST /api/guilds/:id/feedback` rate-limité et volontaire.
- `PATCH /api/guilds/:id/privacy` pour opt-out si pertinent.
- Aucun endpoint analytics détaillé pour clients au départ.
- Vue interne protégée hors panel public ou endpoint super-admin distinct.

## 9. Tables et migrations D1 éventuelles

`product_metrics(day, event, module, outcome, cohort_bucket, count)` sans identifiant utilisateur ; éventuel `guild_privacy`. Feedback séparé, texte limité, rétention 30–90 jours et accès restreint.

## 10. Modifications Gateway

Émettre seulement événements fonctionnels agrégables déjà connus ; préférer Worker comme point de collecte. Aucun contenu/message/username/channel.

## 11. Modifications Worker

Allowlist taxonomie, agrégation, opt-out, purge, seuil de k-anonymat pour affichages si nécessaire et séparation des permissions.

## 12. Modifications panel

Instrumentation onboarding/modules, réglage confidentialité clair, formulaire feedback volontaire et aucun tracker tiers/cookie marketing.

## 13. Sécurité et permissions

Privacy by design : aucune PII/contenu, finalité documentée, minimisation, opt-out, rétention, accès interne. Ne pas utiliser les analytics pour sanctionner ou profiler un membre.

## 14. Performance et montée en charge

Agrégation/batch, dimensions bornées et maximum une écriture par bucket. Sampling inutile à petite échelle. Budget D1 explicite.

## 15. Risques

Surcollecte, petits échantillons trompeurs, feedback contenant des données privées, confusion avec M1, instrumentation fragile.

## 16. Dépendances

Requiert M1/M2 et doit instrumenter M6. M3 fournit IDs modules. Guide alternatives et C1/C2.

## 17. Développement par phases

1. Questions produit et taxonomie minimale.
2. Politique confidentialité/opt-out.
3. Agrégation backend sur 3–5 événements.
4. Instrumenter onboarding/modules.
5. Dashboard interne/feedback.
6. Revue après un mois avant extension.

## 18. Tests

Allowlist/refus propriété libre, opt-out, purge, agrégation concurrente, isolation, scan PII, contenu feedback limité, permissions tableau et absence de tracker réseau tiers.

## 19. Rollback

Collecte désactivable globalement ; panel fonctionne sans. Migration additive. Purge documentée et possible sur demande sans toucher données métier.

## 20. Indicateurs de réussite

- ≥80 % du funnel onboarding mesurable.
- 0 PII ou contenu Discord dans événements.
- Feedback volontaire exploitable sur ≥10 % des désinstallations sollicitées, à revalider à plus grande échelle.

## 21. Estimation détaillée

Conception 1–2 j ; développement 3–5 j ; tests 1–2 j ; docs 1–2 j ; total 6–11 j. Rallonges : politique légale, super-admin et qualité des petits échantillons.

## 22. Documentation

Finalités, taxonomie, données exclues, rétention, opt-out, accès, interprétation statistique et différence observabilité/analytics.

## 23. Passation à Claude

Claude commence par les questions auxquelles répondre, pas par les événements faciles à collecter. Tout champ non listé est interdit.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Implémente « Analytics produit respectueuses de la vie privée » selon docs/milestone-codex/08-analytics-produit.md après M1/M2/M3/M6. Crée milestone/privacy-analytics depuis master propre avec point de restauration.

Avant code, formule au maximum cinq questions produit et une taxonomie finie permettant d’y répondre. Présente données collectées, exclues, rétention, opt-out et séparation M1 pour validation. Aucun tracker tiers, cookie marketing, contenu Discord, identifiant utilisateur, propriété libre ou profil individuel.

Commits : politique/types, agrégation D1 bornée, instrumentation onboarding/modules, opt-out/feedback, vue interne. Migration additive, purge et rollback, jamais remote sans accord. Teste allowlist, PII, opt-out, concurrence, permissions, absence réseau tiers. Check/tests/build et documentation confidentialité. Ne déploie pas.
```
