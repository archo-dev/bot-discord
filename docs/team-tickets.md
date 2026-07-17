# Tickets d'équipe (M09)

M09 transforme le module tickets existant en file de triage volontairement bornée. L'ancien panneau `ticket:open`, les tickets `open/closed` et le flux de fermeture/transcript restent compatibles.

## Fonctionnalités

- formulaire Discord versionné avec 1 à 5 catégories et 0 à 3 questions ;
- questions courtes ou paragraphe, 1 000 caractères maximum ;
- assignation unique, priorité `normal|high` et états `open|pending|closed` ;
- actions de triage depuis Discord pour les rôles support et les administrateurs ;
- actions de triage depuis le panel pour les accès administrateur uniquement ;
- timeline de métadonnées bornée à 100 événements par ticket et purgée après 180 jours ;
- statistiques agrégées sans lecture des réponses ni des transcripts ;
- indicateur « vieillissant » après 24 heures, sans rappel automatique.

Le scheduler C2.0 n'étant pas disponible, M09 ne crée aucun timer mémoire et n'envoie aucun rappel actif.

## Modèle d'état et compatibilité

`tickets.state` est la source M09 (`open`, `pending`, `closed`). La colonne historique `tickets.status` reste alimentée pour l'ancien code :

- `open` et `pending` correspondent à `status = 'open'` ;
- `closed` correspond à `status = 'closed'`.

La migration `0030_team_tickets.sql` initialise l'état depuis le statut existant sans recopier ni modifier les transcripts. `ticket_open_claims` sérialise les ouvertures concurrentes avant tout appel Discord. Si la création Discord ou la finalisation D1 échoue, le Worker supprime le salon éventuellement créé et annule la réservation.

## Permissions

- Ouverture : tout membre ayant accès au panneau publié.
- Fermeture : créateur, rôle support configuré ou membre avec `MANAGE_GUILD`.
- Assignation, état et priorité sur Discord : rôle support ou `MANAGE_GUILD`, revérifié à chaque interaction.
- Lecture du panel : politique d'accès panel existante, toujours scoppée par `guildId`.
- Mutation du panel : `manage_guild` ou `panel_admin`; les modérateurs panel restent en lecture seule.

Les IDs de ticket sont toujours recherchés avec la guilde courante. Un ID valide d'une autre guilde ne donne ni lecture ni mutation.

## Confidentialité

Les réponses de formulaire et transcripts sont du contenu privé. Ils sont chargés explicitement depuis la fiche d'un ticket et ne participent jamais aux statistiques. Les événements ne contiennent que le type d'action, l'acteur, l'ancienne/nouvelle valeur et la date.

Le transcript historique reste conservé selon la politique actuelle du bot. M09 ne crée aucune copie supplémentaire. La fermeture peut envoyer le fichier dans le salon de transcripts configuré ; un échec d'envoi ne bloque pas la fermeture enregistrée.

## API panel

- `GET|PUT /api/guilds/:guildId/tickets/settings`
- `POST /api/guilds/:guildId/tickets/panel`
- `GET /api/guilds/:guildId/tickets` avec filtres `state`, `priority`, `assignee`
- `PATCH /api/guilds/:guildId/tickets/:ticketId` avec action explicite
- `GET /api/guilds/:guildId/tickets/:ticketId/events`
- `GET /api/guilds/:guildId/tickets/:ticketId/transcript`
- `GET /api/guilds/:guildId/tickets/stats`

La configuration tickets fait partie des snapshots M07. Les références à la catégorie, au salon de transcripts et aux rôles support sont remappables lors d'un import inter-serveurs. Les tickets, réponses et transcripts ne sont jamais inclus dans un snapshot de configuration.

## Déploiement et rollback

1. Créer un snapshot de configuration incluant `tickets`.
2. Appliquer `0030_team_tickets.sql` localement, puis à distance seulement après autorisation.
3. Déployer le Worker/panel séparément et republier les panneaux pour activer le formulaire v2.
4. Vérifier ouverture, claim concurrent, attente, priorité, fermeture et accès transcript sur une guilde pilote.

Rollback applicatif : redéployer la version précédente. Elle continue de voir `pending` comme un ticket historique `status = 'open'` et peut le fermer. Les colonnes et tables M09 restent en place ; elles sont additives. Ne pas supprimer la migration en production. Pour revenir à une configuration antérieure, restaurer le snapshot M07 pris avant modification.

## Limites

- une seule personne assignée ;
- pas de SLA, escalade, tags libres, pièces jointes de formulaire ou automatisation ;
- pas de rappel actif avant C2.0 ;
- maximum 5 catégories, 3 questions et 100 événements par ticket.
