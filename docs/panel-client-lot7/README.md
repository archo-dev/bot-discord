# Lot 7 — finalisation responsive du panel client

## Résultat

Les 34 routes demandées ont été auditées localement à 1440, 1280, 1024,
768, 390 et 320 px, ainsi qu’à 200 %. Les 238 combinaisons finales sont
validées sans scroll horizontal global. La matrice détaillée est disponible
dans [audit-matrix.md](audit-matrix.md).

L’audit automatisé a utilisé exclusivement des réponses locales vérifiées,
interceptées dans le navigateur de test. Ces fixtures ne sont pas intégrées
au produit et le script temporaire d’audit est supprimé après validation.

## Corrections du Lot 7

- Niveaux : le classement devient une liste de cartes sous 768 px ; les
  récompenses et sélecteurs s’empilent sans pousser la grille.
- Logs vocaux : les événements deviennent des cartes mobiles en conservant
  action, membre, salon et date.
- Modération et sanctions : historique, avertissements et exemptions passent
  en cartes mobiles ; toutes les informations et actions restent présentes.
- Accès : les identifiants Discord acceptent la césure, les lignes et le
  formulaire d’ajout s’empilent, les contrôles restent utilisables au toucher.
- Primitives partagées : headers de page, toolbars et actions de cartes
  s’empilent de façon contrôlée ; les tableaux utiles restent dans une région
  de scroll interne bornée et accessible au clavier.
- Drawer, menus, combobox et modales : dimensions bornées au viewport
  dynamique, scroll interne, overscroll contenu, safe area et boutons de
  fermeture confortables.
- SaveBar : contenu remanié sous 360 px, boutons empilés à 320 px, padding
  inférieur et safe area préservés.
- Cibles tactiles : toggles, pagination, segments, effacement de sélection et
  boutons d’icône critiques ont des dimensions stables.
- Footer public et détails tarifaires : liens tactiles agrandis sans changer
  les routes ni le contenu.

## Comportements validés

- Desktop : sidebar fixe et stable, tableaux denses, toolbars horizontales,
  workspaces en trois colonnes.
- Tablette : sidebar compacte, retours à la ligne contrôlés, workspaces en
  deux colonnes avec le contexte après le contenu.
- Mobile : drawer modal, workspaces en une colonne, tables adaptées en cartes
  lorsque nécessaire, actions visibles sans survol.
- Très petit mobile : SaveBar et confirmations empilées à 320 px, aucun
  contenu essentiel coupé.
- Zoom 200 % : largeur CSS utile de 720 px, navigation, overlays, tableaux et
  formulaires utilisables sans chevauchement.
- Paysage mobile : audit complémentaire à 844 × 390 px sans débordement.

## Interactions et accessibilité

L’audit d’interactions confirme :

- ouverture du drawer avec verrouillage du fond et focus à l’intérieur ;
- fermeture par Échap avec restitution du focus ;
- recherche globale ouverte et champ automatiquement focalisé ;
- menu contextuel entièrement visible à 320 px et utilisable au clavier ;
- confirmation mobile bornée au viewport, avec fermeture 40 × 40 px et
  actions 270 × 40 px ;
- état modérateur lisible avec champs non autorisés désactivés ;
- états Gateway connecté/hors ligne et liste de commandes vide visibles ;
- focus visible, ordre logique, libellés accessibles et
  `prefers-reduced-motion` préservé.

## Tables adaptées

| Page | Desktop | Tablette / mobile |
| --- | --- | --- |
| Niveaux | Tableau dense | Cartes de classement |
| Logs vocaux | Tableau dense | Cartes événement |
| Modération | Tableau d’historique | Cartes de sanction |
| Sanctions | Tableaux avertissements/exemptions | Cartes membre et rôle |
| Audit et autres tables utiles | Tableau | Scroll interne borné, jamais global |

## Fichiers concernés par la passe finale

- `packages/panel/src/pages/Levels.tsx`
- `packages/panel/src/pages/VoiceLog.tsx`
- `packages/panel/src/pages/Sanctions.tsx`
- `packages/panel/src/pages/PanelAccess.tsx`
- `packages/panel/src/pages/GuildLayout.tsx`
- `packages/panel/src/components/public/PublicFooter.tsx`
- `packages/panel/src/components/public/landing/PlansTeaser.tsx`
- `packages/panel/src/ui/combobox.tsx`
- `packages/panel/src/ui/menu.tsx`
- `packages/panel/src/ui/overlay.tsx`
- `packages/panel/src/ui/savebar.tsx`
- `packages/panel/src/ui/kit/buttons.tsx`
- `packages/panel/src/ui/kit/forms.tsx`
- `packages/panel/src/ui/kit/layout.tsx`
- `packages/panel/src/ui/kit/navigation.tsx`
- `packages/panel/src/ui/kit/segmented.tsx`
- `packages/panel/src/ui/kit/surfaces.tsx`
- `packages/panel/test/responsive-polish.test.ts`

Le worktree contient également les modifications déjà validées des Lots 1 à
6 ; elles ont été conservées telles quelles.

## Tests

| Contrôle | Résultat |
| --- | --- |
| `pnpm --filter @bot/panel check` | Réussi |
| `pnpm --filter @bot/panel test` | 40 fichiers, 319 tests réussis |
| `pnpm --filter @bot/panel build` | Réussi, 922 modules |
| `pnpm --filter @bot/panel check:bundle` | 167,1 kB gzip / 180,0 kB |
| `pnpm --filter @bot/panel check:csp` | Aucun `eval()` ou `new Function()` |
| `git diff --check` | Réussi |
| Scan de secrets | Aucun secret détecté |

Le bundle initial était de 167,0 kB gzip après le Lot 6 et atteint 167,1 kB
après le Lot 7, soit +0,1 kB et une marge finale de 12,9 kB.

## Captures

1. [Landing 1440](captures/01-landing-1440.png)
2. [Dashboard 1440](captures/02-dashboard-1440.png)
3. [Dashboard 1024 et sidebar compacte](captures/03-dashboard-1024-sidebar-compacte.png)
4. [Dashboard 768](captures/04-dashboard-768.png)
5. [Dashboard 390](captures/05-dashboard-390.png)
6. [Dashboard 320](captures/06-dashboard-320.png)
7. [Drawer mobile](captures/07-drawer-mobile.png)
8. [Rôles tablette](captures/08-roles-tablette.png)
9. [Rôles mobile](captures/09-roles-mobile.png)
10. [Commandes mobile](captures/10-commandes-mobile.png)
11. [Automatisations mobile](captures/11-automatisations-mobile.png)
12. [Tickets mobile](captures/12-tickets-mobile.png)
13. [Musique mobile](captures/13-musique-mobile.png)
14. [Niveaux converti en cartes](captures/14-tableau-cartes-niveaux.png)
15. [SaveBar mobile 320](captures/15-savebar-mobile-320.png)
16. [Modale mobile](captures/16-modale-mobile.png)
17. [Zoom 200 %](captures/17-zoom-200.png)
18. [Graphique mobile](captures/18-graphique-mobile.png)
19. [Paysage mobile](captures/19-paysage-mobile.png)

## Limites et périmètre

- L’audit est exécuté dans Chromium local avec fixtures réseau déterministes ;
  il ne remplace pas une recette sur appareils physiques et clavier virtuel
  natif.
- Les tooltips sont validés via les composants et les parcours clavier ; les
  interactions principales ouvertes sont consignées dans
  `browser-audit-interactions.json`.
- Aucun endpoint, DTO, Worker, Gateway, D1, billing, enforcement, Developer
  Studio ou autre composant backend n’a été modifié.
- Aucune fonctionnalité ni route n’a été supprimée. Aucun déploiement n’a été
  effectué et le Lot 8 n’a pas été commencé.
