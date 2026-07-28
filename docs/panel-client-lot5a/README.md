# Lot 5A — Page Rôles du panel client

## Périmètre livré

Le Lot 5A refond uniquement la page Rôles et les primitives strictement nécessaires à son workspace. Les Lots 5B, 5C et 5D ne sont pas commencés.

Fichiers créés :

- `packages/panel/src/components/modules/ModuleWorkspace.tsx`
- `packages/panel/src/components/previews/DiscordMessagePreview.tsx`
- `packages/panel/src/lib/roles-preview.ts`
- `packages/panel/test/roles-preview.test.ts`
- `packages/panel/test/roles-workspace.test.ts`
- `docs/panel-client-lot5a/README.md`
- les dix captures de `docs/panel-client-lot5a/captures/`

Fichiers modifiés :

- `packages/panel/src/pages/Roles.tsx`
- `packages/panel/src/ui/savebar.tsx`
- `packages/panel/src/ui/overlay.tsx`

Les autres changements du worktree appartiennent aux Lots 1 à 4 déjà validés.

## Structure finale

### Configuration

La colonne prioritaire regroupe trois sections courtes :

1. destination : salon cible ;
2. contenu : titre et description ;
3. rôles et boutons : rôle attribué, libellé, emoji et couleur Discord.

Le comportement historique est explicitement conservé : un clic attribue le rôle et un second clic le retire. Les compteurs et limites existants restent identiques : titre 256 caractères, description 2 000, libellé 80, emoji 8 et 25 boutons maximum.

### Aperçu Discord

`DiscordMessagePreview` reçoit uniquement une projection du brouillon React local :

- auteur générique `Bot du serveur`, car le nom Discord réel n’existe pas dans les contrats chargés ;
- titre et description ;
- accent d’embed Discord fixe, identique à la couleur `0x5865f2` utilisée par le Worker existant ;
- boutons, emojis et quatre styles Discord ;
- rôle réellement associé à chaque bouton ;
- exemple de réponse privée d’ajout ou de retrait ;
- état vide pris en charge.

Le composant ne contient ni `fetch`, ni client API, ni query, ni mutation. Les caractères spéciaux sont rendus comme du texte React et les contenus longs restent présents dans le brouillon, avec une limite visuelle scrollable dans l’aperçu.

L’aperçu est clairement présenté comme indicatif : le nom réel du bot, la police, les espacements et certains détails finaux restent contrôlés par Discord.

### Contexte et publication

La troisième zone affiche uniquement des informations vérifiables :

- état réel du module `button_roles`, depuis le contrat `/modules` existant ;
- état Gateway, explicitement non requis par ce module ;
- niveau d’accès administration ou lecture seule ;
- capacité de configuration ;
- salon sélectionné ;
- nombre de messages publiés ;
- date du dernier message, uniquement depuis le vrai `createdAt` du DTO ;
- état du brouillon ;
- permissions Discord et hiérarchie des rôles ;
- messages déjà publiés et action de suppression autorisée.

Aucun statut de synchronisation, date de sauvegarde ou brouillon distant n’est inventé.

## Champs et actions préservés

Champs conservés sans changement de valeur par défaut :

- salon ;
- titre `Choisissez vos rôles` ;
- description `Cliquez sur un bouton pour recevoir (ou retirer) le rôle.` ;
- rôle cible ;
- libellé ;
- emoji ;
- style Bleu / Gris / Vert / Rouge.

Actions conservées :

- ajouter jusqu’à 25 boutons ;
- modifier rôle, libellé, emoji et style ;
- retirer un bouton du brouillon ;
- publier le message ;
- supprimer un message publié avec confirmation.

Il n’existe pas de contrat de modification d’un message publié. Aucune action `Mettre à jour` n’est donc affichée.

## Brouillon, publication et états UX

Le brouillon est un objet local immuable. Chaque changement produit une nouvelle projection immédiatement visible dans l’aperçu.

- état propre : `Brouillon prêt` ;
- dirty state : `Modifications non publiées` avec garde de navigation ;
- publication en cours : barre annoncée avec spinner ;
- publication réussie : `Message publié`, boutons remis à zéro et nouvelle baseline locale ;
- erreur : message persistant dans la SaveBar et brouillon intégralement conservé ;
- réinitialisation : retour à la dernière baseline propre ;
- permission insuffisante : formulaire neutralisé et explication visible ;
- modérateur : consultation seule, aucune publication ou suppression proposée ;
- Gateway indisponible : état visible mais publication non bloquée, conformément au module `gateway: "none"` ;
- suppression : confirmation modale, mutation verrouillée pendant l’appel, erreur visible dans la modale et restitution du focus au bouton déclencheur.

La SaveBar accepte désormais des libellés adaptés à l’action réelle, une présence propre optionnelle, un bouton désactivable, un libellé de lecture seule et la safe area mobile. Les comportements par défaut des autres pages restent inchangés.

## Données et mutations

Lectures :

- `GET /api/guilds/:guildId/button-roles` : messages publiés ;
- `GET /api/guilds/:guildId/channels` : salons ;
- `GET /api/guilds/:guildId/roles` : rôles attribuables ;
- `GET /api/guilds/:guildId/modules` : état, capacités et prérequis du module.

Mutations existantes, inchangées :

- `POST /api/guilds/:guildId/button-roles` : publication ;
- `DELETE /api/guilds/:guildId/button-roles/:id` : suppression.

La publication exige :

- accès administrateur ;
- capacité `canConfigure` du module ;
- salon sélectionné ;
- titre non vide ;
- au moins un bouton ;
- rôle et libellé valides pour chaque bouton.

La Gateway n’est pas une condition de publication. Le Worker revérifie le salon, les permissions Discord, le quota et les contrats au moment du `POST`.

La suppression n’est présentée qu’aux administrateurs, sur un message réellement chargé, après confirmation. Les rôles déjà attribués restent conservés.

## Responsive et accessibilité

- 1440 px : grille 6/3/3, configuration prioritaire, aperçu sticky et contexte compact ;
- 1024 px : configuration 7/12, aperçu 5/12, contexte sous les deux ;
- 390 et 320 px : une colonne dans l’ordre Configuration → Aperçu → Contexte ;
- aucun débordement horizontal observé à 1440, 1024, 390 ou 320 px ;
- boutons de SaveBar pleine largeur sur mobile et respect de `env(safe-area-inset-bottom)`.

Contrôles :

- tous les champs possèdent un label lié ;
- les boutons utilisent un fieldset et une légende ;
- les erreurs de validation sont associées via `Field` ;
- les statuts de publication utilisent `role="status"` et `aria-live="polite"` ;
- l’aperçu possède un nom accessible ;
- les emojis complètent un libellé textuel et ne portent jamais seuls l’information ;
- la confirmation est un dialogue modal avec focus trap, Échap, verrouillage pendant mutation et restitution du focus ;
- aucune information d’état ne dépend uniquement de la couleur ;
- aucun contenu important n’est réservé au survol.

## Tests et audit navigateur

- `pnpm --filter @bot/panel check` : réussi ;
- `pnpm --filter @bot/panel test` : 33 fichiers et 254 tests réussis ;
- `pnpm --filter @bot/panel build` : réussi ;
- `pnpm --filter @bot/panel check:bundle` : réussi ;
- `pnpm --filter @bot/panel check:csp` : réussi ;
- `git diff --check` : réussi ;
- scan ciblé de secrets : réussi.

Les tests dédiés couvrent :

- valeurs historiques et état vide ;
- ajout, modification et retrait de rôle ;
- titre, description, caractères spéciaux et contenu long ;
- synchronisation du preview ;
- validation et payload POST exact ;
- remise à zéro après publication ;
- trois zones responsive ;
- mutations strictement limitées à POST et DELETE ;
- absence de réseau dans le preview ;
- lecture seule, capacités, Gateway et confirmation accessible.

L’audit navigateur a confirmé :

- synchronisation immédiate du titre, de la description, de l’emoji et du bouton ;
- dirty state annoncé ;
- publication réussie avec zéro bouton restant et état propre ;
- erreur Discord avec valeur du titre et brouillon conservés ;
- Gateway hors ligne non bloquante sur un brouillon valide ;
- permission insuffisante visible et formulaire désactivé ;
- modérateur sans publication ni suppression ;
- état publié vide ;
- ordre mobile ;
- aucun scroll horizontal jusqu’à 320 px ;
- bouton principal de 254 px à 320 px ;
- focus rendu au bouton Supprimer après fermeture de la confirmation.

## Bundle

Bundle JS initial gzip :

- avant le Lot 5A : 166,3 kB ;
- après le Lot 5A : 166,3 kB ;
- variation mesurée : 0,0 kB ;
- budget : 180,0 kB, marge restante 13,7 kB.

La page Rôles reste une route différée :

- avant : 2,50 kB gzip ;
- après : 6,56 kB gzip ;
- variation du chunk lazy : +4,06 kB gzip.

Aucune dépendance n’a été ajoutée.

## Captures

1. `captures/01-page-roles-avant.png`
2. `captures/02-page-roles-apres-desktop.png`
3. `captures/03-formulaire-modifie-apercu-synchronise.png`
4. `captures/04-contexte-publication.png`
5. `captures/05-etat-non-enregistre.png`
6. `captures/06-erreur-gateway.png`
7. `captures/07-lecture-seule-moderateur.png`
8. `captures/08-tablette-1024.png`
9. `captures/09-mobile-390.png`
10. `captures/10-confirmation-suppression.png`

Les valeurs visibles dans les captures sont des fixtures locales réservées à l’audit ; elles ne sont pas intégrées au produit.

## Limites connues

- aucun brouillon distant ni enregistrement séparé de la publication n’existe ;
- aucun endpoint de mise à jour d’un message publié n’existe ;
- le DTO ne fournit pas le nom ou l’avatar réel du bot ;
- l’aperçu ne garantit pas un rendu pixel-perfect Discord ;
- le statut des messages supprimés manuellement dans Discord n’est pas exposé comme synchronisation distante.

## Confirmation de périmètre

Aucun DTO, endpoint, contrat partagé, Worker, Gateway, D1, migration, billing ou enforcement n’a été modifié. Aucun déploiement n’a été effectué. Les Lots 5B, 5C et 5D n’ont pas été commencés.
