# Correctif statistiques du panel

Validation locale du 28 juillet 2026. Aucun déploiement n’a été effectué.

## Origine et correction du total

`buildPresenceChartData` calculait auparavant le total en additionnant
`online + idle + dnd + offline`. Or ces valeurs proviennent du cache de
présences Gateway et ne représentent que les présences connues : le donut
affichait donc la taille du sous-ensemble observé, pas la population du serveur.

Le total sélectionné est maintenant :

1. `GuildOverview.approximateMemberCount`, donnée Discord `with_counts` déjà
   chargée et mise en cache par le flux existant ;
2. à défaut seulement, le dernier `MemberSnapshotPoint.total` déjà présent.

Les trois statuts actifs sont assainis en entiers positifs. Leur somme est
normalisée proportionnellement si elle dépasse temporairement le total. Le
quatrième segment est toujours :

`Hors ligne = max(0, total réel - en ligne - absent - ne pas déranger)`

Le compteur `offline` reçu de la Gateway n’est plus utilisé pour construire le
total. Les quatre segments sont donc non négatifs et leur somme est exactement
égale au total sélectionné, y compris avec un total nul, des données manquantes
ou une collecte temporairement incohérente.

Le cache Discord à l’origine des agrégats est indexé par utilisateur ; le
frontend ne reçoit pas d’identités à dédupliquer. Une présence dupliquée,
orpheline ou brièvement conservée après un départ ne peut ainsi plus gonfler le
total ni produire un segment négatif : l’agrégat actif est borné et normalisé
contre la population autoritaire. Le contrat frontend existant ne permet pas
d’attribuer une éventuelle présence orpheline à un identifiant précis, et
aucune donnée de ce type n’est inventée.

Les bots restent inclus dans le total. Le résumé ajoute
`95 membres, dont 93 humains et 2 bots` uniquement lorsque le dernier snapshot
est cohérent (`humains + bots = total`) et correspond exactement au total
sélectionné. Une ventilation périmée ou approximative n’est pas affichée.

Cas de référence validé :

- total : 95 ;
- en ligne : 4 ;
- absent : 1 ;
- ne pas déranger : 2 ;
- hors ligne : 88 ;
- somme : 95 ;
- pourcentages calculés avec 95 comme dénominateur.

## Durées vocales

La fonction pure `formatVoiceDuration(seconds, unit)` conserve la donnée
source en secondes et ne modifie ni l’agrégation, ni le tri, ni les requêtes.

- Auto : moins de 1 h → minutes/secondes ; moins de 24 h →
  heures/minutes/secondes ; à partir de 24 h →
  jours/heures/minutes/secondes.
- Minutes : total des minutes puis secondes restantes.
- Heures : total des heures puis minutes et secondes restantes.
- Jours : total des jours puis heures, minutes et secondes restantes.

Pour `6 862 min 31 s`, les rendus sont respectivement
`4 j 18 h 22 min 31 s`, `6 862 min 31 s`, `114 h 22 min 31 s` et
`4 j 18 h 22 min 31 s`.

Le groupe `Auto | Minutes | Heures | Jours` réutilise le contrôle segmenté
ARIA : groupe radio nommé, `aria-checked`, navigation Flèche gauche/droite,
Home et End. Il agit sur les valeurs visibles, les titres natifs des barres et
le résumé accessible. La préférence est stockée localement sous la clé
versionnée `panel:stats:voice-duration-unit:v1` avec le mécanisme
`readStoredValue` / `writeStoredValue`. Une valeur absente, invalide ou
inaccessible revient à `Auto`.

À 390 et 320 px, les quatre options restent visibles, les longues valeurs
passent correctement dans la largeur de la carte et
`document.documentElement.scrollWidth === innerWidth`.

## Fichiers modifiés

- `packages/panel/src/components/charts/DashboardCharts.tsx`
- `packages/panel/src/components/dashboard/DashboardGrid.tsx`
- `packages/panel/src/lib/chart-data.ts`
- `packages/panel/src/lib/voice-duration.ts`
- `packages/panel/src/pages/Dashboard.tsx`
- `packages/panel/src/pages/Stats.tsx`
- `packages/panel/src/ui/charts.tsx`
- `packages/panel/test/chart-data.test.ts`
- `packages/panel/test/chart-structure.test.ts`
- `packages/panel/test/voice-duration.test.ts`

Documentation et captures : `docs/panel-statistics-fix/`.

## Tests et contrôles

- `pnpm --filter @bot/panel check` : réussi ;
- `pnpm --filter @bot/panel test` : réussi, 41 fichiers et 331 tests ;
- `pnpm --filter @bot/panel build` : réussi ;
- `pnpm --filter @bot/panel check:bundle` : réussi ;
- `pnpm --filter @bot/panel check:csp` : réussi ;
- `git diff --check` : réussi ;
- scan ciblé de secrets : aucune correspondance.

La suite couvre le cas 95/4/1/2/88, les bots, les pourcentages, les présences
manquantes, tout hors ligne, tout en ligne, le total nul, les valeurs invalides
et le dépassement temporaire. Elle couvre aussi 26 secondes, 91 min 31 s,
6 862 min 31 s, les quatre modes, les seuils Auto, zéro, une grande durée,
la précision à la seconde et la préférence locale.

Bundle initial gzip :

- avant : 167,2 kB / 180,0 kB ;
- après : 167,2 kB / 180,0 kB ;
- variation arrondie : 0,0 kB ; marge restante : 12,8 kB.

## Captures

La capture « avant » est la fixture visuelle historique du donut, où le total
était encore la somme des présences. Les captures corrigées utilisent une
interception locale des contrats existants avec 95 membres, 93 humains,
2 bots et `6 862 min 31 s`. Ces fixtures ne sont pas intégrées au produit.

1. [Donut avant](captures/01-donut-avant.png)
2. [Donut corrigé avec total réel](captures/02-donut-corrige-total-reel.png)
3. [Résumé corrigé](captures/03-resume-corrige.png)
4. [Classement vocal — Auto](captures/04-vocal-auto.png)
5. [Classement vocal — Minutes](captures/05-vocal-minutes.png)
6. [Classement vocal — Heures](captures/06-vocal-heures.png)
7. [Classement vocal — Jours](captures/07-vocal-jours.png)
8. [Affichage mobile 390 px](captures/08-vocal-mobile-390.png)
9. [Affichage mobile 320 px](captures/09-vocal-mobile-320.png)

Les captures et le contrôle navigateur confirment quatre options présentes,
un état actif textuel/ARIA, le passage clavier de `Auto` à `Minutes` et aucun
débordement horizontal global aux deux largeurs mobiles.

## Périmètre

Aucun fichier Worker, Gateway, contrat partagé, endpoint, requête, migration ou
stockage serveur n’a changé. Aucun déploiement n’a été lancé.

CORRECTIF STATISTIQUES DU PANEL TERMINÉ — TOTAL DES MEMBRES ET UNITÉS VOCALES CORRIGÉS.
