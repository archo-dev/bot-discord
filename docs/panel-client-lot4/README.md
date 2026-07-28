# Lot 4 — Graphiques du panel client

## Périmètre livré

Le Lot 4 modernise les visualisations du Dashboard et d’Observabilité / Stats avec une charte Nocturne commune. Il ne modifie aucune page module du Lot 5.

Fichiers créés :

- `packages/panel/src/components/charts/ChartCard.tsx`
- `packages/panel/src/components/charts/DashboardCharts.tsx`
- `packages/panel/src/lib/chart-data.ts`
- `packages/panel/test/chart-data.test.ts`
- `packages/panel/test/chart-structure.test.ts`
- `docs/panel-client-lot4/README.md`
- les dix captures de `docs/panel-client-lot4/captures/`

Fichiers modifiés pour ce lot :

- `packages/panel/src/App.tsx`
- `packages/panel/src/components/dashboard/DashboardGrid.tsx`
- `packages/panel/src/pages/Dashboard.tsx`
- `packages/panel/src/pages/Stats.tsx`
- `packages/panel/src/pages/dashboard-view-model.ts`
- `packages/panel/src/ui/charts.tsx`
- `packages/panel/src/ui/kit/segmented.tsx`
- `packages/panel/src/ui/skeleton.tsx`
- `packages/panel/test/dashboard-structure.test.ts`

Les autres changements du worktree appartiennent aux Lots 1 à 3 déjà validés.

## Charte et composants communs

- `ChartCard` fournit le titre, la description, l’action, la légende, le contenu, les états loading / erreur / vide, le résumé accessible et le footer.
- `ActivityAreaChart`, `RankedBarChart` et `PresenceDonut` sont réutilisés sans divergence sur le Dashboard et Stats.
- Les surfaces sombres, bordures discrètes, grille légère, axes atténués et valeurs tabulaires reprennent les tokens Nocturne.
- Le violet identifie les arrivées et les classements, le vert les départs et la présence en ligne ; l’ambre, le rose et le gris complètent le donut.
- Les tooltips partagent la même surface, la même hiérarchie et les mêmes formats numériques.

## Sources, titres et transformations

| Visualisation | Source existante | Transformation frontend | Titre retenu |
| --- | --- | --- | --- |
| Activité | `MemberStatsDto.deltas`, endpoint existant `/stats/members?days=7|30|90` | tri des jours, `joins` → arrivées, `leaves` → départs, total quotidien ; valeurs invalides ou négatives neutralisées | `Mouvements de membres` |
| Événements | `ScheduledEventDto[]`, endpoint existant `/stats/events` | conservation des seuls `interestedCount` non nuls et finis, tri décroissant, date en détail | `Intérêt pour les événements Discord` |
| Présence | `PresenceStatsDto`, endpoint existant `/stats/presence` | somme des quatre segments, valeur et part calculées pour chaque statut | `Répartition des membres` sur le Dashboard, `Présence des membres` dans Stats |
| Salons, Stats uniquement | `ChannelStatsDto`, endpoint existant `/stats/channels` | libellés résolus depuis la liste existante, valeurs valides triées par ordre décroissant | `Salons les plus actifs` |

L’activité ne fabrique aucun jour à zéro. Une série partielle annonce le nombre de jours réellement observés et calcule sa moyenne uniquement sur ces jours. Une série vide ne produit ni moyenne, ni pic, ni tendance.

Le classement des événements n’affiche aucun pourcentage : la source expose un nombre d’intéressés par événement mais aucun dénominateur vérifié permettant une proportion honnête. Les valeurs restent lisibles sans survol.

Le total du donut est exactement `online + idle + dnd + offline`. Chaque pourcentage vaut `segment / total × 100`; lorsque le total est nul, les quatre pourcentages valent zéro et la carte passe dans son état vide.

## Chargement différé et bundle

`DashboardGrid` charge `DashboardCharts` par `React.lazy` et affiche trois `ChartCard` skeleton de mêmes dimensions pendant l’import. Le Dashboard, son grid et le chunk initial ne possèdent aucun import statique de `ui/charts` ou de Recharts.

Stats reste une route différée. Le build extrait ainsi :

- `charts-*.js` : 113,76 kB gzip, différé et partagé ;
- `DashboardCharts-*.js` : 1,44 kB gzip, différé ;
- `Stats-*.js` : 2,15 kB gzip, différé.

Bundle JS initial gzip :

- avant le Lot 4, baseline validée du Lot 3 : 166,4 kB ;
- après le Lot 4 : 166,3 kB ;
- variation mesurée : −0,1 kB ;
- budget : 180,0 kB, marge restante 13,7 kB.

Aucune nouvelle dépendance n’a été ajoutée.

## Accessibilité

- Chaque carte relie son titre, sa description et son résumé avec `aria-labelledby` et `aria-describedby`.
- Les graphiques Recharts utilisent leur couche d’accessibilité et restent focalisables.
- L’AreaChart expose aussi un tableau détaillé repliable ; les barres et la légende du donut montrent toutes les valeurs sans tooltip.
- Les statuts ne dépendent jamais uniquement de la couleur : libellés, valeurs, rangs et pourcentages restent visibles.
- Les animations Recharts sont désactivées quand `prefers-reduced-motion: reduce` est actif ; la transition des barres l’est aussi.
- Les filtres sont des groupes radio. Flèches gauche / droite et touches Home / End changent la période et déplacent le focus.
- L’audit navigateur a confirmé le passage clavier de `7 j` à `90 j`.

## Responsive et contrôle navigateur

- 1440 px : activité large, classement compact et donut avec légende à droite.
- 1024 px : rail compact conservé ; Stats empile les cartes tout en gardant la légende du donut lisible.
- 390 px : cartes empilées, filtres accessibles, axes allégés et légende du donut sous le graphique.
- Aucun scroll horizontal observé à 1440, 1024 ou 390 px.
- États contrôlés : données normales, série vide, série partielle, segments nuls ou à zéro, chargement retardé et tooltip ouvert.
- `prefers-reduced-motion: reduce` a été émulé et détecté dans le navigateur.

## Validation

- `pnpm --filter @bot/panel check` : réussi ;
- `pnpm --filter @bot/panel test` : 31 fichiers et 237 tests réussis ;
- `pnpm --filter @bot/panel build` : réussi ;
- `pnpm --filter @bot/panel check:bundle` : réussi, 166,3 kB / 180,0 kB ;
- `pnpm --filter @bot/panel check:csp` : réussi, aucun `eval()` ou `new Function()` ;
- `git diff --check` : réussi ;
- scan ciblé de secrets : réussi.

Les tests couvrent les périodes 7 / 30 / 90 jours, les séries vides et partielles, le tri des barres, les valeurs invalides, le total et les pourcentages du donut, les segments nuls ou à zéro, les composants partagés, le résumé accessible, le reduced motion et l’absence d’import Recharts dans le parcours initial.

## Captures

1. `captures/01-activite-desktop.png`
2. `captures/02-activite-mobile.png`
3. `captures/03-classement-horizontal.png`
4. `captures/04-donut-desktop.png`
5. `captures/05-donut-mobile.png`
6. `captures/06-dashboard-complet.png`
7. `captures/07-stats-observabilite.png`
8. `captures/08-etat-vide.png`
9. `captures/09-skeleton-graphiques.png`
10. `captures/10-tooltip-ouvert.png`

Les données de capture sont des fixtures locales explicitement utilisées pour l’audit visuel ; elles ne sont pas intégrées au produit et ne sont jamais présentées comme des données de production.

## Confirmation de périmètre

Aucun endpoint, contrat partagé, Worker, Gateway, D1, migration, billing ou enforcement n’a été modifié. Aucun déploiement n’a été effectué. Le Lot 5 n’a pas été commencé.
