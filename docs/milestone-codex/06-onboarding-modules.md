# Milestone 6 — Onboarding guidé et centre des modules

## 1. Résumé

Créer un parcours public cohérent depuis la découverte jusqu’à la première valeur : vitrine sobre, invitation expliquée, sélection serveur, checklist, presets et centre des modules alimenté par M3.

## 2. Problème et preuves

- La racine authentifiée affiche seulement les serveurs déjà installés ; le cas vide explique `/ping` mais n’invite pas directement.
- Les prérequis Gateway/intents/permissions sont dispersés dans les pages.
- Aucun funnel d’installation, page publique produit ou documentation utilisateur structurée.
- La base locale vide a récemment illustré combien la distinction installation/enregistrement peut être déroutante.

## 3. Valeur utilisateur

Comprendre le produit avant OAuth, inviter avec confiance et obtenir un serveur utile en moins de dix minutes.

## 4. Valeur technique

Configurations valides, moins de support, activation modulaire mesurable et point d’entrée pour documentation/feedback.

## 5. Comparaison concurrentielle

MEE6 excelle par plugins et setup depuis dashboard ; Dyno associe invite, guides et documentation ; ProBot présente visuellement les cas d’usage. Le bot doit reprendre ces fondamentaux sans upsell omniprésent.

## 6. Architecture proposée

- Landing publique servie par le Worker : valeur, modules, confidentialité, statut, docs, invitation.
- Générateur d’invitation avec scopes/permissions minimales documentées.
- État onboarding calculé côté Worker à partir de M3 : installé, enregistré, prérequis, première config.
- Checklist non bloquante et presets explicites, appliqués comme transaction/configs validées.
- Centre modules consommant `/modules`, avec filtres et diagnostics.
- Deep-links depuis erreurs vers l’étape corrective.

## 7. Packages, modules et fichiers concernés

Panel routes publiques, Login, GuildList, GuildLayout, Dashboard et nouvelles pages onboarding/modules. Worker OAuth/guilds/modules et assets. Shared DTO onboarding. Documentation utilisateur.

## 8. Routes API concernées

- `GET /api/guilds/:id/onboarding`.
- `POST /api/guilds/:id/onboarding/preset` admin/rate-limité.
- `GET /api/guilds/:id/modules` de M3.
- Invitation générée côté serveur ou URL statique sûre, sans secret.

## 9. Tables et migrations D1 éventuelles

Éviter une table si l’état peut être dérivé. Stocker seulement `onboarding_completed_at`, version de preset et étapes explicitement ignorées si utile. Migration additive légère.

## 10. Modifications Gateway

Rapporter prérequis runtime fiables (intents, connexion, permissions détectables). Aucun parcours interactif Gateway requis.

## 11. Modifications Worker

Calcul checklist, application atomique des presets, URLs OAuth/invite, pages publiques/assets et codes de diagnostic.

## 12. Modifications panel

Landing responsive, wizard accessible, centre modules, reprise de progression, aperçu des changements d’un preset, états erreur/lecture seule et documentation contextuelle.

## 13. Sécurité et permissions

Demander le minimum ; expliquer chaque permission. Presets admin uniquement, confirmation et audit M2. Aucun tracking avant consentement/politique B4. Liens OAuth avec state existant.

## 14. Performance et montée en charge

Landing statique cacheable, données checklist en une requête groupée, lazy-load des modules, aucun appel Discord par carte. Cache métadonnées serveur existant.

## 15. Risques

Wizard trop long, presets écrasant une config, permissions Discord impossibles à détecter précisément, divergence landing/produit, SEO/support à maintenir.

## 16. Dépendances

Requiert M2 et M3 ; bénéficie de M1. B4 instrumentera ensuite le funnel. B3 sécurisera l’application de presets par snapshot.

## 17. Développement par phases

1. Recherche parcours et checklist minimale.
2. Landing/invitation/docs essentielles.
3. Endpoint état et diagnostics.
4. Wizard sans presets.
5. Presets avec aperçu/transaction.
6. Centre modules et tests pilotes.

## 18. Tests

OAuth/invite, serveur absent/non géré/bot absent, admin/modérateur, preset rollback, prérequis Gateway, mobile/clavier, reprise, liens profonds et anciennes URLs.

## 19. Rollback

Landing et wizard derrière routes indépendantes ; dashboard actuel reste accessible. Presets utilisent snapshot/transaction et n’effacent pas les réglages non concernés. Désactivation possible sans toucher configs.

## 20. Indicateurs de réussite

- ≥70 % des installations terminent une première configuration.
- Temps médian invitation → module actif <10 min.
- Baisse des serveurs installés sans module configuré.

## 21. Estimation détaillée

Conception 1–2 j ; développement 5–8 j ; tests 2–3 j ; docs 1–2 j ; total 9–15 j. Rallonges : design landing, permissions d’invite et presets multi-modules.

## 22. Documentation

Guide installation, permissions, prérequis Gateway/intents, presets, dépannage « serveur absent », désinstallation et confidentialité.

## 23. Passation à Claude

Claude doit utiliser le registre M3, pas recréer des conditions dans React. Le wizard doit rester optionnel, réversible et utilisable sans Gateway local.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Implémente « Onboarding guidé et centre des modules » selon docs/milestone-codex/06-onboarding-modules.md, après confirmation que M2/M3 sont déployées. Branche milestone/onboarding-modules depuis master propre, point de restauration, audit préalable du parcours OAuth/invite/configuration et plan validé.

Réutilise strictement le registre modules et les routes existantes. Commits : landing/invitation, état checklist, wizard, presets transactionnels, centre modules, documentation. Ne demande aucune permission Discord non justifiée, n’ajoute aucune donnée fictive ni tracking avant B4. Les presets montrent leur diff, sont admin-only, auditables et réversibles ; aucune config non ciblée n’est écrasée.

Teste OAuth, cas vide, bot absent, rôles panel, prérequis, rollback preset, responsive/clavier et anciennes routes. Migration additive uniquement si l’état ne peut pas être dérivé, jamais remote sans validation. Check/tests/build, docs et rollback. Aucun déploiement.
```
