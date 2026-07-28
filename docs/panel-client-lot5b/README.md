# Lot 5B — Pages Communauté du panel client

## Périmètre livré

Le Lot 5B refond uniquement les deux pages prioritaires :

- **Bienvenue** ;
- **Starboard**.

Après audit, **Niveaux** et **Vocaux temporaires** restent inchangés :

- Niveaux possède déjà une configuration dense en masonry et un classement alimenté par des données réelles. Un aperçu de progression aurait soit dupliqué ce contenu, soit imposé des valeurs fictives ;
- Vocaux temporaires est un formulaire court et cohérent. Une grille en trois zones aurait créé de l’espace vide, tandis qu’un schéma de salons n’aurait pas apporté assez d’information au regard du contrat actuel.

Les Lots 5C et 5D ne sont pas commencés. Aucun déploiement n’a été effectué.

## Fichiers

Fichiers créés :

- `packages/panel/src/components/modules/ModuleStatusPanel.tsx` ;
- `packages/panel/src/components/previews/CommunityPreviews.tsx` ;
- `packages/panel/src/lib/community-preview.ts` ;
- `packages/panel/test/community-preview.test.ts` ;
- `packages/panel/test/community-workspace.test.ts` ;
- `docs/panel-client-lot5b/browser-audit.json` ;
- `docs/panel-client-lot5b/README.md` ;
- les dix captures de `docs/panel-client-lot5b/captures/`.

Fichiers modifiés :

- `packages/panel/src/pages/Welcome.tsx` ;
- `packages/panel/src/pages/Starboard.tsx` ;
- `packages/panel/src/components/modules/ModuleWorkspace.tsx`.

`ModuleWorkspace` accepte désormais des descriptions de zones optionnelles. Ses valeurs par défaut conservent exactement le texte utilisé par Rôles ; cette page ne change donc pas de comportement.

## Structure finale

Les deux pages réutilisent le workspace validé au Lot 5A :

1. **Configuration** prioritaire ;
2. **Aperçu Discord** local et indicatif ;
3. **Contexte et publication**, contenant uniquement l’état et les prérequis réellement disponibles.

`ModuleStatusPanel` centralise uniquement la présentation du contrat `/modules` : état, Gateway, accès, capacité, activation du brouillon, salon cible et dirty state. Il n’ajoute aucune règle métier.

### Bienvenue

La configuration regroupe :

- activation du message de bienvenue ;
- salon de bienvenue ;
- message de bienvenue ;
- activation du message de départ ;
- salon de départ ;
- message de départ ;
- salon des journaux ;
- les neuf événements de journaux historiques.

Les limites existantes restent inchangées : chaque message accepte au maximum 2 000 caractères. Les variables conservées sont `{mention}`, `{user}`, `{user.id}`, `{server}` et `{membercount}`.

Il n’existe dans le DTO actuel aucun champ de titre, description d’embed, couleur, image ou bannière. Aucun de ces champs n’a été inventé.

### Starboard

La configuration regroupe :

- activation ;
- salon cible ;
- seuil de 1 à 50 réactions ;
- emoji de 1 à 64 caractères ;
- règles d’éligibilité et exclusions actuellement appliquées.

Les règles visibles reflètent le comportement existant : exclusion des bots, de l’auteur et du salon Starboard, actualisation du compteur et suppression sous le seuil. Elles sont informatives, car le contrat actuel ne permet pas de les configurer.

## Aperçus locaux

Les aperçus ne contiennent ni appel API, ni query, ni mutation.

Bienvenue :

- remplace toutes les occurrences des variables dans le brouillon local ;
- marque chaque valeur de remplacement comme une démonstration ;
- conserve les caractères spéciaux, sauts de ligne et contenus longs ;
- affiche un état vide réel ;
- reste consultable lorsque le message est désactivé.

Starboard :

- affiche un auteur, un contenu, un salon source et une pièce jointe explicitement simulés ;
- synchronise localement emoji, seuil et salon cible ;
- indique clairement qu’aucun message réel du serveur n’est chargé ;
- affiche une configuration incomplète lorsque le salon ou l’emoji manque.

Aucune publication, date, statistique ou donnée Discord distante n’est fabriquée.

## Données, mutations et actions préservées

Lectures Bienvenue :

- `GET /api/guilds/:guildId/welcome` ;
- `GET /api/guilds/:guildId/log-settings` ;
- `GET /api/guilds/:guildId/channels` ;
- `GET /api/guilds/:guildId/modules`.

Mutations Bienvenue, inchangées et dans le même ordre :

- `PUT /api/guilds/:guildId/welcome` ;
- `PUT /api/guilds/:guildId/log-settings`.

Lectures Starboard :

- `GET /api/guilds/:guildId/starboard-settings` ;
- `GET /api/guilds/:guildId/channels` ;
- `GET /api/guilds/:guildId/modules`.

Mutation Starboard inchangée :

- `PUT /api/guilds/:guildId/starboard-settings`.

Les seules actions de formulaire restent enregistrer et réinitialiser. Aucun `POST`, `PATCH`, `DELETE`, endpoint ou DTO n’a été ajouté.

## États UX, permissions et Gateway

Les deux pages prennent en charge :

- chargement par squelette ;
- contenu vide ;
- erreur de lecture avec relance ;
- dirty state ;
- sauvegarde en cours ;
- confirmation de sauvegarde réussie ;
- erreur de sauvegarde persistante avec brouillon conservé ;
- lecture seule ;
- permission ou capacité de configuration insuffisante ;
- Gateway indisponible ;
- module désactivé ;
- prérequis manquants issus du contrat `/modules`.

La SaveBar du Lot 5A est réutilisée sans second toast de succès. Après réussite, les données écrites deviennent immédiatement la nouvelle baseline locale. En cas d’erreur, aucun champ n’est réinitialisé.

La Gateway est requise pour l’exécution réelle de Bienvenue et Starboard, mais son indisponibilité ne bloque pas l’enregistrement des réglages, conformément aux contrats existants. La lecture seule et une capacité `canConfigure` absente neutralisent les contrôles.

## Responsive et accessibilité

- 1440 px : grille 6/3/3, aperçu sticky et contexte compact ;
- 1024 px : configuration et aperçu sur deux colonnes, contexte sous le contenu principal ;
- 390 et 320 px : une colonne dans l’ordre Configuration → Aperçu → Contexte ;
- aucun débordement horizontal observé aux quatre largeurs ;
- la SaveBar conserve sa safe area et ses actions pleine largeur sur mobile.

Contrôles d’accessibilité :

- champs contenus dans des labels associés ;
- groupes structurés avec `fieldset` et `legend` ;
- erreurs de champ transmises par `Field` avec `aria-invalid` et `aria-describedby` ;
- interrupteurs nommés et exposés avec `role="switch"` ;
- aperçus nommés avec un libellé accessible ;
- sauvegarde annoncée par `role="status"` et `aria-live="polite"` ;
- focus clavier visible ;
- aucune information importante uniquement par couleur ou au survol ;
- caractères rendus comme texte React, sans injection HTML.

## Tests et audit navigateur

Contrôles obligatoires :

- `pnpm --filter @bot/panel check` : réussi ;
- `pnpm --filter @bot/panel test` : **35 fichiers, 268 tests réussis** ;
- `pnpm --filter @bot/panel build` : réussi ;
- `pnpm --filter @bot/panel check:bundle` : réussi ;
- `pnpm --filter @bot/panel check:csp` : réussi ;
- `git diff --check` : réussi ;
- scan ciblé de secrets : réussi.

Les 14 tests dédiés couvrent :

- toutes les variables et leurs répétitions ;
- caractères spéciaux, sauts de ligne, vide et texte de 2 000 caractères ;
- seuil, emoji, salon et configuration incomplète du Starboard ;
- bornage de la projection sans mutation du brouillon ;
- trois zones, composants réutilisés et absence de réseau dans les aperçus ;
- conservation exacte des lectures, des deux `PUT` Bienvenue et du seul `PUT` Starboard ;
- champs, limites, neuf journaux, règles et exclusions historiques ;
- lecture seule, permissions, Gateway, module désactivé et erreur silencieuse de formulaire ;
- absence volontaire de refonte de Niveaux et Vocaux temporaires.

L’audit navigateur consigné dans `browser-audit.json` valide **27 contrôles** :

- synchronisation immédiate des deux aperçus ;
- dirty state ;
- réussite de sauvegarde et retour à un état propre ;
- erreur de sauvegarde avec brouillon conservé ;
- états vides et erreurs de lecture ;
- Gateway indisponible ;
- module désactivé ;
- capacité insuffisante ;
- lecture seule avec contrôles neutralisés ;
- absence de scroll horizontal à 1440, 1024, 390 et 320 px sur les deux pages.

Cet audit a également détecté puis permis de corriger l’ordre des états Starboard : une erreur de lecture sans donnée pouvait auparavant rester derrière le squelette.

## Bundle

Bundle JS initial gzip :

- avant le Lot 5B : **166,3 kB** ;
- après le Lot 5B : **166,3 kB** ;
- variation : **0,0 kB** ;
- budget : 180,0 kB, marge restante 13,7 kB.

Les pages restent différées :

- chunk direct Bienvenue : 2,19 kB gzip avant, 3,87 kB après ;
- chunk direct Starboard : 1,20 kB gzip avant, 3,01 kB après ;
- projection et aperçus communautaires mutualisés : 2,62 kB gzip ;
- workspace mutualisé : 0,61 kB gzip.

Aucune dépendance n’a été ajoutée.

## Captures

1. `captures/01-bienvenue-avant-desktop.png`
2. `captures/02-bienvenue-apres-desktop.png`
3. `captures/03-bienvenue-apercu.png`
4. `captures/04-bienvenue-apres-mobile.png`
5. `captures/05-starboard-avant-desktop.png`
6. `captures/06-starboard-apres-desktop.png`
7. `captures/07-starboard-apercu.png`
8. `captures/08-starboard-apres-mobile.png`
9. `captures/09-gateway-indisponible.png`
10. `captures/10-lecture-seule.png`

Les valeurs visibles sont des fixtures locales réservées à l’audit. Elles ne sont ni intégrées au produit, ni présentées comme des données réelles.

## Limites connues

- la sauvegarde Bienvenue reste composée de deux `PUT` séquentiels et n’est pas atomique ; ce comportement historique n’a pas été modifié ;
- le DTO Bienvenue ne fournit aucun embed, titre, couleur, image ou bannière ;
- le DTO Starboard ne fournit ni historique, ni publication, ni contenu de message réel ;
- les exclusions Starboard ne sont pas configurables ;
- le nom et l’avatar réels du bot ne sont pas exposés sur ces pages ;
- les aperçus sont indicatifs et ne garantissent pas le rendu final pixel-perfect de Discord.

## Confirmation de périmètre

Aucun contrat partagé, DTO, endpoint, Worker, Gateway, migration, D1, billing ou enforcement n’a été modifié. Aucun déploiement n’a été effectué. Les Lots 5C et 5D restent en attente.
