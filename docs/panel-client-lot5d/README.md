# Lot 5D — Tickets et Musique

## Résultat

Le Lot 5D réorganise exclusivement les pages Tickets et Musique du panel client. Tickets devient un espace en trois zones avec configuration, aperçu local et contexte contractuel. Musique devient un espace temps réel compact articulé autour du lecteur, de la recherche, de la file et du contexte du moteur.

Aucun fichier du Developer Studio, du backend, du Worker, de la Gateway, de D1, du billing, de l’enforcement, de SoundCloud ou de yt-dlp n’a été modifié. Aucun endpoint, DTO, quota ou feature flag n’a été ajouté ou modifié. Aucun déploiement n’a été effectué et le Lot 6 n’a pas été commencé.

## Fichiers du lot

### Modifiés

- `packages/panel/src/pages/Tickets.tsx`
- `packages/panel/src/pages/Music.tsx`
- `packages/panel/src/components/MusicSearchPanel.tsx`

### Créés

- `packages/panel/src/components/previews/TicketPanelPreview.tsx`
- `packages/panel/src/lib/ticket-preview.ts`
- `packages/panel/src/lib/music-view.ts`
- `packages/panel/test/ticket-music-workspaces.test.ts`
- `docs/panel-client-lot5d/browser-audit.json`
- les captures de `docs/panel-client-lot5d/captures/`

## Structure finale Tickets

La page réutilise `ModuleWorkspace`, `SaveBar`, `useDirty`, les états vides/erreur/skeleton, `ChannelSelect`, les confirmations accessibles existantes et les composants de liste du kit.

La zone Configuration contient :

1. activation et catégorie Discord cible ;
2. salon optionnel des transcripts ;
3. rôles support, limités à 10 par le contrat ;
4. formulaire de triage avec 1 à 5 catégories et 0 à 3 questions ;
5. validations locales documentées, en français et liées aux champs.

La zone Aperçu contient :

- un rendu Discord indicatif du titre, de la description et du bouton ou sélecteur de catégorie ;
- une gestion explicite des contenus vides et longs ;
- la mention qu’il s’agit d’une démonstration locale sans appel réseau ;
- la publication historique du panneau dans un salon réel.

La zone Contexte affiche :

- état réel du module et capacité de configuration ;
- accès administrateur ou lecture seule ;
- Gateway indiquée comme non requise, conformément au registre du module Tickets ;
- catégorie, rôles support, transcripts et état du triage ;
- permissions requises ;
- quota journalier de publication existant, sans inventer son utilisation courante.

Les statistiques réelles et la liste existante sont conservées. La liste ajoute une recherche locale clairement limitée à la page chargée ; les filtres état, priorité et assignation continuent d’être envoyés au serveur. Numéro, auteur, salon, catégorie, date, assignation et actions historiques restent visibles. Sur mobile, les lignes se replient en cartes et toutes les actions restent tactiles.

## Structure finale Musique

La colonne principale contient :

1. lecteur et état réel ;
2. piste, progression, salon vocal, demandeur, volume et répétition réellement disponibles ;
3. contrôles pause/reprise, suivante, mélange, arrêt, répétition, volume et seek existants ;
4. recherche réelle via le moteur existant ;
5. file réelle, dans son ordre serveur, avec suppression existante.

La colonne de contexte contient :

- état du module ;
- état Gateway et moteur ;
- salon vocal ;
- niveau d’accès ;
- permissions `view_channel`, `send_messages`, `connect` et `speak` ;
- quota journalier de contrôle existant, sans valeur d’utilisation inventée ;
- playlists réellement retournées.

Le panel ne possède aucun endpoint de réglages musicaux persistants. En conséquence, aucune fausse zone de configuration et aucune SaveBar n’ont été ajoutées à Musique. Volume, répétition, seek, lecture, pause, piste suivante, ajout et suppression de file restent exclusivement des actions temps réel et ne produisent jamais de dirty state.

## MusicSearchPanel

- recherche bornée à 3–500 caractères et debounce existant de 700 ms ;
- annulation de la recherche obsolète par `MusicSearchCoordinator` ;
- garde contre le double ajout par `MusicSubmissionGuard` ;
- skeletons, résultat vide et erreur réseau distincts ;
- résultats structurés avec titre, auteur disponible, durée, type, source dérivée de l’URL réelle et compte de pistes de playlist ;
- ajout du résultat sélectionné via son URL publique quand elle existe, sans nouvelle source musicale ;
- annonce de succès/erreur et restitution du focus au champ de recherche après ajout ;
- contenus longs repliés sans débordement.

## Contrats et mutations préservés

### Tickets

- `GET /api/guilds/:guildId/tickets/settings`
- `PUT /api/guilds/:guildId/tickets/settings`
- `POST /api/guilds/:guildId/tickets/panel`
- `GET /api/guilds/:guildId/tickets/stats`
- `GET /api/guilds/:guildId/tickets`
- `GET /api/guilds/:guildId/tickets/:id/events`
- `GET /api/guilds/:guildId/tickets/:id/transcript`
- `PATCH /api/guilds/:guildId/tickets/:id`

Actions historiques conservées : assigner/libérer, mettre en attente/repasser ouvert, changer la priorité, rouvrir, consulter les détails et charger un transcript. Aucune suppression ou fermeture depuis le panel n’existe dans le contrat actuel ; aucune action fictive n’a donc été ajoutée.

### Musique

- `GET /api/guilds/:guildId/music-state`
- `POST /api/guilds/:guildId/music-control`
- `POST /api/guilds/:guildId/music-search`
- `POST /api/guilds/:guildId/music-enqueue`
- `GET /api/guilds/:guildId/playlists`

L’ordre de file reste celui du DTO. Aucun déplacement ni vidage global n’est proposé, car ces actions ne sont pas exposées par `MusicControlRequest`.

## Brouillon et erreurs

Tickets compare une projection stable du formulaire au dernier réglage serveur. `useDirty` protège la fermeture d’onglet et `SaveBar` protège la navigation interne. Une erreur conserve tous les champs ; un succès actualise immédiatement la baseline puis remet l’état sale à zéro. Il n’y a ni sauvegarde automatique, ni double mutation, ni double feedback de sauvegarde.

La publication du panneau reste une mutation distincte, bloquée tant que la configuration est sale, invalide ou sans catégorie cible. Les actions musicales n’interagissent jamais avec cette logique.

## Responsive et accessibilité

L’audit navigateur couvre 1440, 1024, 390 et 320 px sur les deux pages. Les 41 contrôles passent, dont l’absence de scroll horizontal aux quatre largeurs.

Tickets utilise labels, fieldsets, légendes masquées, erreurs reliées aux champs, statuts explicites et lecture seule désactivant réellement les contrôles. L’aperçu possède un nom accessible et ne présente pas d’état de ticket fictif.

Musique annonce l’état de lecture via `aria-live`, nomme textuellement tous les contrôles, expose une progression lisible, conserve l’ordre clavier, structure les résultats et restitue le focus après ajout. Aucune action importante ne dépend uniquement d’une icône, d’une couleur ou du survol.

## Validation exécutée

| Contrôle | Résultat |
| --- | --- |
| `pnpm --filter @bot/panel check` | OK |
| `pnpm --filter @bot/panel test` | 38 fichiers, 298 tests réussis |
| `pnpm --filter @bot/panel build` | OK |
| `pnpm --filter @bot/panel check:bundle` | OK |
| `pnpm --filter @bot/panel check:csp` | OK, aucun `eval()` ou `new Function()` |
| `git diff --check` | OK |
| scan de secrets ciblé Lot 5D | OK, aucun motif sensible détecté |
| audit navigateur | 41/41 contrôles réussis |

Bundle JS initial :

- avant Lot 5D : 166,4 kB gzip ;
- après Lot 5D : 166,4 kB gzip ;
- budget : 180,0 kB gzip ;
- marge restante : 13,6 kB gzip.

Les pages restent chargées à la demande. Les chunks directs passent de 5,54 à 8,66 kB gzip pour Tickets et de 5,46 à 7,93 kB gzip pour Musique, sans augmenter le bundle initial.

## Captures

### Tickets

- [Avant desktop](captures/01-tickets-avant-desktop.png)
- [Après desktop](captures/02-tickets-apres-desktop.png)
- [Aperçu et tablette](captures/03-tickets-apercu.png)
- [État Gateway](captures/04-tickets-etat-gateway.png)
- [Lecture seule](captures/05-tickets-lecture-seule.png)
- [Mobile 390 px](captures/06-tickets-mobile-390.png)

### Musique

- [Avant desktop](captures/07-musique-avant-desktop.png)
- [Après desktop](captures/08-musique-apres-desktop.png)
- [Recherche et résultats](captures/09-musique-recherche.png)
- [Piste en cours et pause](captures/10-musique-piste-en-cours.png)
- [File d’attente](captures/11-musique-file-attente.png)
- [État vide](captures/12-musique-etat-vide.png)
- [Erreur](captures/13-musique-erreur.png)
- [Mobile 390 px](captures/14-musique-mobile-390.png)

## Limites connues

- Le quota courant Tickets/Musique n’est pas exposé par les réponses de ces pages ; seule l’existence du quota contractuel est affichée.
- Tickets ne possède pas d’option de fermeture ou suppression depuis le panel.
- Musique ne possède pas de réglage persistant, d’action de vidage total ou de déplacement de file dans le contrat actuel.
- La progression musicale entre deux instantanés est interpolée localement, comme auparavant ; le DTO Gateway reste l’autorité.
- La source musicale n’est pas un champ du DTO : le panel affiche uniquement le domaine de l’URL publique réelle quand il existe.
