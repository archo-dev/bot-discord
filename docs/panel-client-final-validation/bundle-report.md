# Bundle et performance

Budget : **180 kB gzip** pour le JavaScript initial.

## Comparaison

La référence avant refonte a été reconstruite depuis le commit de base du worktree (`a63871b`) dans un worktree détaché temporaire, avec les dépendances locales.

| Mesure | Avant refonte | Final | Différence |
|---|---:|---:|---:|
| JavaScript initial gzip | 157,6 kB | 167,2 kB | +9,6 kB |
| Marge sous 180 kB | 22,4 kB | 12,8 kB | -9,6 kB |
| CSS gzip | 13,13 kB | 16,08 kB | +2,95 kB |
| Modules transformés | 899 | 922 | +23 |

Le bundle final respecte le budget avec **12,8 kB de marge**.

## Chunks principaux finaux

| Chunk | Gzip | Chargement |
|---|---:|---|
| entrée `index-6Q2xc4ND.js` | 132,4 kB selon le calcul du budget | initial |
| `react-core-CZpU_JKN.js` | 34,8 kB selon le calcul du budget | initial |
| `charts-CvtFncsx.js` | 113,76 kB | différé |
| `DashboardCharts-Cv1nlzmI.js` | 1,44 kB | différé |
| `Stats-woukT-9t.js` | 2,15 kB | différé |

Les noms de fichiers sont hachés et changeront à la prochaine modification. La séparation structurelle est validée par les tests et `check:bundle`.

## Recharts et lazy loading

Recharts demeure exclusivement dans le chunk `charts-*`, chargé avec les graphiques. Il n'entre pas dans les 167,2 kB initiaux. Les pages publiques, client et serveur importantes restent découpées en chunks lazy ; les tests importent chaque page différée pour vérifier son exposition.

## Requêtes Dashboard et caches

Le Dashboard lance **5 requêtes de données propres à la vue** :

1. membres, selon la période 7/30/90 jours ;
2. présence ;
3. événements ;
4. santé ;
5. actions de modération, page 1.

Le shell fournit séparément la session `/api/me` et l'aperçu du serveur `/api/guilds/:guildId`. Une résolution de membre peut être demandée conditionnellement pour les cellules d'activité.

Les clés TanStack Query sont partagées avec Observabilité pour membres/présence/événements, avec Santé pour `health`, et avec Modération pour `mod-actions`. Les invalidations sont ciblées ; les échecs partiels conservent les données déjà disponibles.

## Régression et surveillance

L'augmentation de 9,6 kB est compatible avec le budget et correspond au shell, à la recherche et aux états partagés de la refonte. Aucun chargement initial de Recharts n'a été introduit. La marge de 12,8 kB impose toutefois de conserver `check:bundle` comme contrôle bloquant.
