# Lot 3 — Dashboard connecté dense

## Périmètre livré

Le Lot 3 refond uniquement la Vue d’ensemble du panel connecté. Il utilise les contrats frontend déjà disponibles, ne crée aucun endpoint et ne commence pas les graphiques détaillés du Lot 4.

Fichiers créés :

- `packages/panel/src/components/dashboard/DashboardGrid.tsx`
- `packages/panel/src/components/dashboard/DashboardHeader.tsx`
- `packages/panel/src/pages/dashboard-view-model.ts`
- `packages/panel/test/dashboard-view-model.test.ts`
- `packages/panel/test/dashboard-structure.test.ts`
- `docs/panel-client-lot3/README.md`
- les huit captures de `docs/panel-client-lot3/captures/`

Fichiers modifiés :

- `packages/panel/src/pages/Dashboard.tsx`
- `packages/panel/src/pages/GuildLayout.tsx`
- `packages/panel/src/ui/icons.tsx`
- `packages/panel/src/ui/skeleton.tsx`

Les autres changements du worktree appartiennent aux Lots 1 et 2 déjà validés.

## Grille finale

1. En-tête compact : serveur, contexte court, état Gateway, dernière actualisation et bouton Actualiser.
2. Première rangée : quatre KPI de largeur égale.
3. Deuxième rangée : Activité du serveur (5/12), Événements programmés (4/12), Répartition des membres (3/12).
4. Troisième rangée : Santé du serveur, Actions rapides, Modération récente et Activité récente.

Le Dashboard n’importe pas Recharts. Le chunk différé de Stats reste responsable de cette dépendance et conserve les graphiques détaillés pour le Lot 4.

## Données réellement utilisées

| Bloc | Source frontend existante | Utilisation |
| --- | --- | --- |
| Membres | `GuildOverview.approximateMemberCount` | Valeur explicitement décrite comme estimation Discord |
| Évolution membres | `MemberStatsDto.snapshots` sur 7 jours | Différence entre le premier et le dernier snapshot |
| Activité du serveur | `MemberStatsDto.deltas` sur 7 jours | Arrivées, départs et solde réellement collectés |
| En ligne et répartition | `PresenceStatsDto` | En ligne, absent, ne pas déranger et hors ligne |
| Événements | `ScheduledEventDto[]` | Nom, date et nombre d’intéressés quand il existe |
| Santé | `GuildHealthResponse` | État Gateway et quatre SLO existants |
| Modération récente | `Paginated<ModActionDto>` page 1 | Quatre dernières actions réellement enregistrées |

Aucun total de messages n’est calculé depuis les salons les plus actifs. Les événements programmés restent nommés comme tels et ne sont jamais présentés comme une activité métier.

## Métriques indisponibles et libellés

- Messages 24 h : valeur `—`, état `Non disponible`, explication `Total exact indisponible`.
- Alertes ouvertes : valeur `—`, état `Non disponible`, explication `Aucun domaine d’alertes persistantes configuré`.
- Activité récente : `Non disponible pour le moment`, car aucun flux métier unifié n’est exposé.
- Présence absente : `Non disponible`, avec distinction entre Gateway indisponible et Presence Intent absent.
- Données membres vides : explication indiquant que la collecte sur sept jours ne contient pas encore de données.
- Événements ou modération vides : état vide explicite, sans valeur synthétique.

## Requêtes et caches

Avant le Lot 3, `Dashboard.tsx` déclarait sept observateurs React Query :

1. overview du serveur ;
2. salons ;
3. modération ;
4. statistiques membres ;
5. présence ;
6. activité des salons ;
7. onboarding.

L’overview partageait déjà la clé du shell et était dédupliqué ; le Dashboard pouvait donc produire jusqu’à six requêtes réseau secondaires au chargement.

Après le Lot 3 :

- cinq observateurs pour un administrateur : membres, présence, événements, santé et modération ;
- quatre pour un modérateur : la santé reste désactivée tant que l’accès administrateur n’est pas confirmé ;
- l’overview est transmis directement par le contexte du shell, sans second observateur dans le Dashboard.

Caches partagés :

- `["stats-members", guildId, 7]` avec Stats ;
- `["stats-presence", guildId]` avec Stats ;
- `["stats-events", guildId]` avec Stats ;
- `["health", guildId]` avec Health ;
- `["mod-actions", guildId, "page=1"]` avec la première page de Modération ;
- overview réutilisé directement depuis GuildLayout.

Il ne reste aucune requête redondante propre au Dashboard. Le rafraîchissement utilise `Promise.allSettled` : l’échec d’une source secondaire n’annule ni ne masque les autres blocs.

## Permissions et états

- Administrateur : la requête Health est autorisée et les indicateurs existants sont affichés.
- Modérateur : aucune requête Health de guilde n’est envoyée ; la carte affiche `Accès administrateur requis`.
- Réponse Health 403 : même état insuffisant, sans casser le Dashboard.
- Actions rapides : dérivées du registre central, de ses accès et de ses feature flags.
- Modérateur : raccourcis de consultation conservés, sans transformer l’accès lecture seule en droit d’écriture.
- Gateway indisponible : présence non disponible et indicateurs explicites sur les raccourcis qui en dépendent.
- Une source en erreur possède son propre bouton Réessayer ; les autres cartes restent utilisables.

Le chargement initial sans rôle confirmé est désormais considéré en lecture seule. Cela évite toute requête administrative transitoire.

## Responsive et accessibilité

- Desktop 1440 px : trois rangées denses, quatre KPI et cartes de hauteur équilibrée.
- Tablette 1024 px : deux colonnes quand pertinent, rail de navigation du Lot 2 conservé à 72 px.
- Mobile 390 px : cartes empilées dans l’ordre logique, actions rapides en grille 2 colonnes.
- Aucun débordement horizontal observé à 1440, 1024 ou 390 px.
- Sections titrées, valeurs tabulaires et explications textuelles pour chaque état.
- Le statut n’est jamais exprimé uniquement par la couleur.
- Le bouton Actualiser est nommé et son avancement est annoncé par une zone `aria-live`.
- Les futurs graphiques disposent déjà de résumés textuels.
- Le skeleton reproduit l’en-tête, les quatre KPI, les trois aperçus et les quatre cartes de pilotage.

Audit navigateur :

- administrateur : quatre KPI exacts, santé visible et titres structurés ;
- modérateur : santé verrouillée, consultation annoncée et zéro requête `/api/guilds/:id/health` ;
- source événements en erreur : membres et santé toujours visibles ;
- Gateway indisponible : présence et KPI En ligne explicitement indisponibles ;
- données vides : états vides distincts pour membres, événements et modération ;
- rafraîchissement : fin annoncée avec conservation de l’état indépendant de chaque bloc.

## Validation

- `pnpm --filter @bot/panel check` : réussi ;
- `pnpm --filter @bot/panel test` : 29 fichiers et 222 tests réussis ;
- `pnpm --filter @bot/panel build` : réussi ;
- `pnpm --filter @bot/panel check:bundle` : réussi ;
- `pnpm --filter @bot/panel check:csp` : réussi ;
- `git diff --check` : réussi ;
- scan de secrets ciblé sur les fichiers modifiés et créés : réussi.

Bundle JS initial gzip :

- avant le Lot 3 : 163,4 kB ;
- après le Lot 3 : 166,4 kB ;
- variation : +3,0 kB ;
- budget : 180,0 kB, marge restante 13,6 kB.

Le chunk Stats/Recharts reste différé et conserve une taille gzip de 121,8 kB.

## Captures

1. `captures/01-dashboard-administrateur-desktop.png`
2. `captures/02-dashboard-moderateur-desktop.png`
3. `captures/03-source-secondaire-en-erreur.png`
4. `captures/04-sante-indisponible.png`
5. `captures/05-dashboard-tablette-1024.png`
6. `captures/06-dashboard-mobile-390.png`
7. `captures/07-skeleton-dashboard-complet.png`
8. `captures/08-metrique-non-disponible.png`

## Confirmation de périmètre

Aucun endpoint, DTO, contrat Worker/shared, Worker, Gateway, D1, migration, billing ou enforcement n’a été modifié. Aucun déploiement n’a été effectué. Le Lot 4 n’a pas été commencé.
