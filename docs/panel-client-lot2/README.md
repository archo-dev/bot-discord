# Lot 2 — shell, navigation et recherche globale

## Périmètre livré

Le Lot 2 remplace uniquement le shell du panel connecté. Le contenu du Dashboard n’a pas été refait et aucune API ni aucun service backend n’a été modifié.

Fichiers créés :

- `packages/panel/src/navigation/registry.ts`
- `packages/panel/src/navigation/search-index.ts`
- `packages/panel/src/components/navigation/GuildSidebar.tsx`
- `packages/panel/src/components/navigation/PanelTopbar.tsx`
- `packages/panel/src/components/navigation/GlobalSearch.tsx`
- `packages/panel/test/global-search.test.ts`
- `docs/panel-client-lot2/README.md`
- les neuf captures de `docs/panel-client-lot2/captures/`

Fichiers modifiés pour le Lot 2 :

- `packages/panel/src/App.tsx`
- `packages/panel/src/pages/GuildLayout.tsx`
- `packages/panel/src/pages/Modules.tsx`
- `packages/panel/src/ui/icons.tsx`
- `packages/panel/test/navigation.test.ts`
- `packages/panel/test/resilience.test.ts`

Les autres changements déjà présents dans le worktree concernent le Lot 1 validé et sa documentation.

## Registre central final

`NAVIGATION_REGISTRY` est la source unique des identifiants, groupes, libellés, descriptions, icônes, routes principales et secondaires, mots-clés, paramètres, actions, accès, feature flags, exigences Gateway et identifiants de modules. Il alimente :

- les groupes et entrées de la sidebar ;
- le titre et le contexte de la topbar ;
- les sous-sections ;
- la recherche globale ;
- les chemins principaux du routeur ;
- les tests de compatibilité et d’unicité.

Groupes finaux :

1. Accueil : Vue d’ensemble, Santé du serveur
2. Communauté : Bienvenue, Rôles, Niveaux, Starboard, Vocaux temporaires
3. Modération : Auto-mod, Modération, Tickets, Journaux
4. Automatisation : Commandes personnalisées, Automatisations
5. Audio : Musique
6. Pilotage : Observabilité, Audit, Paramètres

Prise en main, Centre des modules, Accès panel, Confidentialité et Sauvegardes restent accessibles par leurs routes, la recherche ou les sous-sections, sans surcharger la sidebar.

## Correspondance des routes existantes

Toutes les routes sont relatives à `/guilds/:guildId`.

| Route conservée | Destination sélectionnée |
| --- | --- |
| `/` | Accueil → Vue d’ensemble |
| `/health` | Accueil → Santé du serveur |
| `/onboarding` | Accueil → Prise en main, page secondaire recherchable |
| `/welcome` | Communauté → Bienvenue |
| `/roles` | Communauté → Rôles |
| `/levels` | Communauté → Niveaux |
| `/starboard` | Communauté → Starboard |
| `/tempvoice` | Communauté → Vocaux temporaires |
| `/automod` | Modération → Auto-mod |
| `/sanctions` | Modération → Modération |
| `/apply` | Modération → Modération, sous-section Appliquer une sanction |
| `/modlog` | Redirection historique inchangée vers `/sanctions` |
| `/tickets` | Modération → Tickets |
| `/voicelog` | Modération → Journaux |
| `/commands` | Automatisation → Commandes personnalisées |
| `/commands/new` | Commandes personnalisées reste le parent actif |
| `/commands/:commandId` | Commandes personnalisées reste le parent actif |
| `/automations` | Automatisation → Automatisations |
| `/automations/new` | Automatisations reste le parent actif |
| `/automations/:automationId` | Automatisations reste le parent actif |
| `/music` | Audio → Musique |
| `/stats` | Pilotage → Observabilité |
| `/audit` | Pilotage → Audit |
| `/config` | Pilotage → Paramètres |
| `/access` | Paramètres → Accès panel |
| `/privacy` | Paramètres → Confidentialité |
| `/backup` | Paramètres → Sauvegardes |
| `/modules` | Pilotage → Centre des modules, page secondaire recherchable |

Le stockage historique des favoris `panel:navigation-favorites:v1` est conservé. Les anciennes valeurs sous forme de chemin ou d’identifiant sont relues. Une seule entrée porte `aria-current="page"`, y compris lorsqu’une destination active figure aussi dans les favoris.

## Recherche globale

La recherche est visible dans la topbar et s’ouvre au clic, avec `Ctrl+K` ou `Cmd+K`. Elle classe les résultats dans Pages, Modules, Paramètres et Actions.

Elle normalise la casse et les accents et indexe notamment :

- `rôle`, `autorôle`, `reaction role` → Rôles ou réglages associés ;
- `logs vocaux`, `voicelog`, `vocal` → Journaux ;
- `bienvenue`, `welcome`, `arrivée`, `départ` → Bienvenue ;
- `ticket`, `support`, `transcript` → Tickets ;
- `musique`, `audio`, `playlist`, `lecture` → Musique ;
- `audit`, `administration`, `sécurité` → Audit ;
- `automod`, `spam`, `filtre`, `mots interdits` → Auto-mod ;
- `commande`, `slash`, `éditeur` → Commandes personnalisées ;
- `sauvegarde`, `backup`, `export`, `restauration` → Sauvegardes ;
- `accès panel`, `permission`, `délégation`, `modérateur` → Accès panel.

Les flèches, Origine, Fin et Entrée pilotent le résultat actif. Échap ferme la modale et le focus revient au déclencheur.

## Permissions, flags et Gateway

- Les administrateurs voient les destinations et les actions autorisées.
- Un modérateur en lecture seule conserve la navigation de consultation, avec un badge explicite, mais les paramètres et actions d’écriture sont retirés de la recherche.
- Les actions exigeant une Gateway connectée ne sont pas proposées lorsque la Gateway est hors ligne.
- Les exigences Gateway du registre sont testées contre le registre de modules existant.
- Chaque destination porte un champ de feature flag. Aucun nouveau flag n’a été ajouté et les destinations actuelles n’en exigent pas ; le filtre central est prêt à appliquer les flags existants dès qu’une destination en référence un.
- Les pages de modules restent consultables quand la Gateway est indisponible afin d’expliquer leur état ; seules les actions réellement indisponibles sont masquées.

## Responsive et accessibilité

- Desktop 1440 px : sidebar fixe de 252 px, groupes complets, serveur en haut et compte en bas.
- Tablette 1024 px : rail compact de 72 px avec icônes et tooltips accessibles au focus et au survol.
- Mobile 390 px : drawer modal de 280 px, hamburger, scrim, fermeture extérieure, Échap et fermeture après navigation.
- Le drawer piège le focus, verrouille le scroll de fond et restitue le focus au hamburger.
- La recherche est une modale avec combobox, listbox, résultat actif et groupes annoncés.
- Les états exposent `aria-current`, `aria-expanded`, `aria-controls`, `aria-modal` et des libellés explicites.
- Les focus visibles sont conservés. Aucun scroll horizontal global n’a été observé à 390 px.
- Le terme retiré n’apparaît plus dans l’interface.

Audit navigateur réalisé :

- 1440 px : largeur du document égale au viewport, une seule route active ;
- recherche : modale annoncée, champ focalisé, groupes et résultat actif visibles ;
- mobile 390 px : drawer annoncé, focus interne, scroll de fond verrouillé puis restauré ;
- sous-route Commandes : parent unique correctement actif ;
- modérateur : état lecture seule visible et résultats d’écriture filtrés.

## Validation

Résultats finaux :

- `pnpm --filter @bot/panel check` : réussi ;
- `pnpm --filter @bot/panel test` : 27 fichiers et 209 tests réussis ;
- `pnpm --filter @bot/panel build` : réussi ;
- `pnpm --filter @bot/panel check:bundle` : réussi ;
- `pnpm --filter @bot/panel check:csp` : réussi ;
- `git diff --check` : réussi ;
- scan de secrets sur les fichiers modifiés et créés : réussi.

Bundle JS initial gzip :

- avant le Lot 2 : 156,8 kB ;
- après le Lot 2 : 163,4 kB ;
- variation : +6,6 kB ;
- budget : 180,0 kB, marge restante 16,6 kB.

## Captures

1. `captures/01-sidebar-dashboard-desktop-1440.png`
2. `captures/02-dashboard-nouveau-shell-desktop.png`
3. `captures/03-recherche-globale-ouverte.png`
4. `captures/04-resultats-recherche-role.png`
5. `captures/05-sidebar-compacte-tablette-1024.png`
6. `captures/06-drawer-mobile-ferme-390.png`
7. `captures/07-drawer-mobile-ouvert-390.png`
8. `captures/08-commandes-sous-route-parent-actif.png`
9. `captures/09-navigation-moderateur-lecture-seule.png`

## Confirmation de périmètre

Aucun déploiement n’a été effectué. Aucun fichier API, Worker, Gateway, D1, migration, billing ou enforcement n’a été modifié. Le Lot 3 n’a pas été commencé.
