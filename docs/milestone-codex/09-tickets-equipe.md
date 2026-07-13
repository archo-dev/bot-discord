# Milestone 9 — Tickets d’équipe avancés

## 1. Résumé

Faire évoluer les tickets actuels vers un workflow de support d’équipe limité mais complet : formulaires Discord, catégories, assignation, états, priorité simple, rappels, permissions et statistiques agrégées.

## 2. Problème et preuves

- Le module gère settings, panneau, ouverture/fermeture et transcript.
- Il manque triage, claim, motif structuré, état en attente et responsabilité.
- Ticket Tool montre que ces capacités constituent le cœur d’un produit support, mais aussi le risque d’une configuration tentaculaire.
- Les transcripts impliquent contenu privé et exigent une politique explicite.

## 3. Valeur utilisateur

Support organisé, réponses plus rapides, visibilité sur la charge et moins de tickets oubliés.

## 4. Valeur technique

Modèle d’état explicite, permissions testables, statistiques fiables et cas d’usage concret du scheduler.

## 5. Comparaison concurrentielle

Ticket Tool propose formulaires, claims, permissions fines, transcripts et stats, plusieurs éléments premium. Le bot vise les essentiels gratuitement avec une UX plus sobre et une confidentialité claire, sans intégration Drive obligatoire.

## 6. Architecture proposée

- `TicketPanel` versionné avec jusqu’à quelques champs modal/select.
- États : `open`, `pending`, `closed`; assignation unique initiale, journal d’événements.
- Catégorie/motif et priorité `normal|high` sans moteur SLA complexe.
- Permission policy dérivée des rôles support + admin ; opérations idempotentes.
- Rappels via C2.0 si disponible ; sinon affichage des tickets vieillissants sans tâche automatique.
- Statistiques à partir d’événements agrégés, pas de scan de transcripts.

## 7. Packages, modules et fichiers concernés

Shared ticket DTO/schemas ; Worker API/queries/interactions components ; Gateway seulement si événements temps réel requis ; panel Tickets, cells/charts/overlay ; migrations/tests tickets.

## 8. Routes API concernées

- Étendre settings/panels avec version compatible.
- `PATCH /api/guilds/:id/tickets/:ticketId` pour assign/status/priority, avec action explicite.
- Routes stats paginées/agrégées.
- Composants Discord signés/custom IDs versionnés.

## 9. Tables et migrations D1 éventuelles

Colonnes additives tickets : assignee, state/priority/category, timestamps. Nouvelles tables `ticket_forms`, `ticket_events` bornée/rétention. Migration des `open/closed` existants déterministe ; aucun transcript recopié.

## 10. Modifications Gateway

Probablement aucune pour v1. Si rappels/événements passent par Gateway, utiliser B1 et scheduler, jamais un timer mémoire par ticket.

## 11. Modifications Worker

Machine d’état, transactions Discord+D1 avec compensation, permissions, modals/forms, assignation et agrégats.

## 12. Modifications panel

Builder simple de formulaire, liste responsive, filtres, assignation, timeline métadonnées et statistiques. Contenu transcript chargé à la demande, jamais préchargé.

## 13. Sécurité et permissions

Vérifier à chaque action accès au ticket et rôle support ; empêcher deviner un ID. Limiter champs/formulaires, mentions et pièces jointes. Politique de transcript/rétention/accès visible. Audit admin M2.

## 14. Performance et montée en charge

Pagination/index guilde/état/assignee, timeline bornée, stats agrégées, cache rôles/salons. Respect limites Discord 500 canaux/2 000 créations par jour ; quotas par membre/panel.

## 15. Risques

Fuite de canal/transcript, état D1 divergent de Discord, permissions complexes, migration tickets ouverts, trop d’options, scheduler absent.

## 16. Dépendances

M2, M3, M5, M7. M8 confirme demande. Scheduler C2.0 facultatif pour v1, requis pour rappels actifs fiables.

## 17. Développement par phases

1. Recherche/support scope et machine d’état.
2. Migration/additive et API assignation/états.
3. Interactions Discord et permissions.
4. Formulaires limités.
5. Panel responsive/stats.
6. Rappels si scheduler disponible, pilotes et docs.

## 18. Tests

Transitions autorisées/interdites, concurrence claim, compensation Discord, permissions/IDOR, modal hostile, quotas, migration ticket ouvert, transcript, mobile et 429 Discord.

## 19. Rollback

Ancien panneau et fermeture restent compatibles. Colonnes additives. Feature flag par guilde/module ; nouveaux états rabattus vers open/closed pour ancien code. Snapshot M7 avant config.

## 20. Indicateurs de réussite

- ≥95 % des tickets nouveaux catégorisés.
- Temps avant assignation mesurable et en baisse sur pilotes.
- Zéro fuite d’accès dans tests et incidents pilotes.

## 21. Estimation détaillée

Conception 2–3 j ; développement 7–12 j ; tests 3–4 j ; docs 1–3 j ; total 13–22 j. Rallonges : modals dynamiques, compensation et scheduler.

## 22. Documentation

Setup support, permissions, formulaires, états, assignation, quotas, transcripts/confidentialité, dépannage et limites Discord.

## 23. Passation à Claude

Claude doit figer une v1 volontairement petite. Ne pas reproduire toutes les options Ticket Tool, ne pas stocker de transcript supplémentaire et ne pas dépendre du scheduler tant qu’il n’est pas déployé.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Implémente « Tickets d’équipe avancés » selon docs/milestone-codex/09-tickets-equipe.md après M2/M3/M5/M7. Crée milestone/team-tickets depuis master propre et un point de restauration.

Audite tickets actuels, interactions Discord, permissions, transcripts et tickets ouverts. Propose une machine d’état minimale, limites formulaire et stratégie de compatibilité. Exclue les options non essentielles. Si le scheduler C2.0 n’est pas déployé, les rappels automatiques sont hors périmètre.

Commits : schéma/API état, interactions/permissions, formulaires, panel/stats, rappels optionnels/docs. Migration additive avec plan tickets ouverts, backup et rollback, jamais remote sans accord. Opérations idempotentes, compensation Discord/D1, IDOR impossible, contenu transcript à la demande. Teste concurrence, transitions, permissions, quotas, 429, migration, responsive ; check/tests/build. Aucun déploiement.
```
