# Milestone 3 — Gouvernance des modules et capacités

## 1. Résumé

Créer une source de vérité typée décrivant chaque module : état, prérequis, intents, permissions, santé, commandes, version de configuration, quotas et capacités disponibles. Ce registre alimente Worker, Gateway, panel et futurs entitlements sans introduire de paiement.

## 2. Problème et preuves

- Les flags `enabled` et prérequis sont répartis entre tables, DTO Gateway et pages.
- Plusieurs modules dépendent du Gateway ou d’intents, mais la présentation est locale à chaque écran.
- Ajouter un module nécessite route, page, sidebar, config interne et logique de cache manuelles.
- Aucun contrat unique ne dit « configuré mais indisponible », « désactivé » ou « dégradé ».

## 3. Valeur utilisateur

- Comprendre ce qui est actif, utile et bloqué.
- Désactiver réellement les modules inutiles.
- Éviter une configuration valide en apparence mais inactive.

## 4. Valeur technique

- Réduit duplications et dérives entre packages.
- Rend onboarding, quotas, sauvegarde et automation composables.
- Prépare un modèle freemium sans conditions commerciales dispersées.

## 5. Comparaison concurrentielle

MEE6 organise clairement le produit en plugins activables ; Dyno et Carl-bot documentent des modules séparés. L’objectif est d’obtenir cette lisibilité tout en exposant mieux prérequis et santé et en gardant les fonctions fondamentales gratuites.

## 6. Architecture proposée

- `ModuleId` stable et registre statique partagé : libellé, catégorie, dépendances, commandes, intents, permissions, route panel.
- État calculé côté Worker : `disabled | needs_setup | active | degraded | unavailable` avec raisons codées.
- Config versionnée par module ; migrations de config explicites.
- `Capabilities` séparées de `Plan`: une capacité décrit ce que le système autorise, pas pourquoi.
- Quotas lisibles via un service unique, initialement constantes gratuites.
- Gateway ne reçoit que la config des modules temps réel actifs.

## 7. Packages, modules et fichiers concernés

- `shared/src/modules.ts` et API types.
- `worker/src/internal/config.ts`, routes de configuration, queries guildes.
- `gateway/src/worker-api.ts`, `config-cache.ts`, handlers.
- `panel/src/pages/GuildLayout.tsx`, Dashboard, nouveau centre modules.
- Migrations/settings existants et tests de chaque module.

## 8. Routes API concernées

- Nouveau `GET /api/guilds/:guildId/modules`.
- Éventuel `PATCH /api/guilds/:guildId/modules/:moduleId` pour activation explicite.
- `GET /internal/guilds/:id/config` versionné ou enrichi sans casser le Gateway déployé.

## 9. Tables et migrations D1 éventuelles

Option recommandée après inventaire : `guild_modules(guild_id, module_id, enabled, config_version, updated_at)`. Backfill déterministe depuis les settings actuels. Ne pas supprimer les colonnes `enabled` existantes dans la première version.

## 10. Modifications Gateway

- Consommer config versionnée et ignorer proprement les modules inconnus.
- Ne pas enregistrer de handlers dynamiques complexes ; gate rapide par cache.
- Rapporter prérequis runtime et version.

## 11. Modifications Worker

- Calcul central des états et raisons.
- Activation transactionnelle avec validation des prérequis connus.
- Compatibilité dual-read pendant migration.

## 12. Modifications panel

- Centre des modules avec recherche/catégories, état, bénéfice et CTA.
- Sidebar guidée par registre sans masquer brutalement les pages existantes.
- État lecture seule, erreurs et confirmation de désactivation avec conséquences.

## 13. Sécurité et permissions

Activation/désactivation admin uniquement. Ne jamais permettre à une capacité premium future de contourner une permission Discord. Reasons et quotas ne doivent pas exposer d’informations internes.

## 14. Performance et montée en charge

Registre statique sans appel réseau. État serveur retourné en une lecture groupée/cache. Gateway reçoit une config compacte et cache 60 s. Pas de requête par événement.

## 15. Risques

- Deux sources de vérité durant migration.
- Dépendances circulaires.
- Désactivation cassant commandes/panneaux publiés.
- Sur-abstraction pour seulement quelques modules.

## 16. Dépendances

Dépend de M1/M2. Précède onboarding, sauvegarde, tickets et studio. M4 utilise le registre pour attribuer les coûts par module.

## 17. Développement par phases

1. Inventaire complet modules/prérequis/états actuels.
2. Types et registre partagé sans comportement.
3. Calcul d’état Worker et endpoint lecture.
4. Persistance/activation compatible.
5. Config Gateway versionnée.
6. Centre panel et migration progressive des pages.

## 18. Tests

- Exhaustivité registre et IDs stables.
- Matrice dépendances/états/prérequis.
- Backfill et dual-read.
- Ancien Gateway avec nouveau Worker et inversement.
- Permissions, désactivation et impacts Discord simulés.
- Panel clavier/mobile et états.

## 19. Rollback

Conserver flags existants et lecture compatible pendant au moins une version. Le panel peut revenir aux routes actuelles. Ne supprimer les anciens flags qu’après observation et migration dédiée ultérieure.

## 20. Indicateurs de réussite

- 100 % des modules actuels dans le registre.
- 0 module actif avec prérequis manquant non signalé.
- Ajout d’un module sans modification manuelle du shell principal.

## 21. Estimation détaillée

Audit/conception 2 j ; développement 4–7 j ; tests 1–3 j ; documentation 1–2 j ; total 8–14 j. Rallonges : backfill, compatibilité Gateway et définition des conséquences de désactivation.

## 22. Documentation

Catalogue des modules, états/reasons, règle d’ajout, versioning config, dépendances, capacités/quotas et compatibilité de déploiement.

## 23. Passation à Claude

Claude doit résister à l’envie de réécrire toutes les pages. Commencer en lecture, maintenir compatibilité et prouver le registre sur deux modules avant migration générale.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Implémente la milestone « Gouvernance des modules et capacités » de botdiscord après lecture de CLAUDE.md et docs/milestone-codex/03-gouvernance-modules.md. Vérifie que M1/M2 sont déployées, pars de master propre, crée milestone/module-governance et un point de restauration.

Audite tous les modules et produis avant code un tableau ID, flags actuels, prérequis, intents, permissions, routes, config Gateway et conséquence de désactivation. Propose un registre statique partagé, un modèle d’état et une stratégie de compatibilité ancien/nouveau. N’introduis aucune facturation ; sépare capabilities, quotas et plan.

Implémente par commits : types/registre, état Worker/endpoint, migration additive dual-read si validée, config Gateway versionnée, centre panel, migration progressive. Worker reste seul écrivain D1. Aucune suppression de colonne ni migration remote sans accord. Teste exhaustivité, dépendances, backfill, permissions, compatibilité croisée et UX responsive. Lance check/tests/build, documente ajout d’un module et rollback. Ne déploie pas.
```
