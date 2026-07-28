# Lot 5C — Commandes personnalisées et automatisations

## Résultat

Le Lot 5C réorganise exclusivement les espaces de travail client des commandes personnalisées et des automatisations. Les listes sont plus denses sur desktop et deviennent des cartes sur mobile. Les éditeurs séparent le brouillon éditable de son résumé et de son contexte réel, protègent les modifications non enregistrées et conservent les contrats existants.

Aucun fichier du Developer Studio, du backend, du Worker, de la Gateway, de D1, du billing ou de l’enforcement n’a été modifié. Aucun déploiement n’a été effectué et le Lot 5D n’a pas été commencé.

## Fichiers du lot

### Modifiés

- `packages/panel/src/pages/Commands.tsx`
- `packages/panel/src/pages/CommandEditor.tsx`
- `packages/panel/src/pages/command-editor/logic.ts`
- `packages/panel/src/pages/command-editor/ConditionRow.tsx`
- `packages/panel/src/pages/command-editor/ActionRow.tsx`
- `packages/panel/src/pages/Automations.tsx`
- `packages/panel/src/pages/AutomationEditor.tsx`

### Créés

- `packages/panel/src/components/editors/EditorWorkspace.tsx`
- `packages/panel/src/components/previews/CommandPreview.tsx`
- `packages/panel/src/pages/automation-editor/logic.ts`
- `packages/panel/test/editor-projections.test.ts`
- `packages/panel/test/client-editors-workspace.test.ts`
- `docs/panel-client-lot5c/browser-audit.json`
- les captures de `docs/panel-client-lot5c/captures/`

## Structure et composants

Les deux éditeurs utilisent le composant léger `EditorWorkspace` : contenu principal à gauche et rail « Résumé et contexte » à droite sur desktop, deux colonnes adaptées à 1024 px, puis une colonne à 390 et 320 px. `FlowSummary` produit une projection textuelle instantanée du brouillon local.

L’éditeur de commande comporte :

1. identité, description, type et déclencheur ;
2. réponse Discord et embed existants ;
3. conditions ordonnées ;
4. actions ordonnées ;
5. réglages avancés et garde-fous ;
6. résumé du fonctionnement, aperçu Discord local, état du module, Gateway, permissions, quota, erreurs et état du brouillon.

`CommandPreview` dérive son rendu uniquement du formulaire local, remplace les variables visibles par des valeurs explicitement présentées comme démonstration et ne fait aucun appel réseau.

L’éditeur d’automatisation comporte :

1. identité, activation, cadence et limites ;
2. déclencheur issu du catalogue existant ;
3. conditions et regroupement logique ;
4. actions et paramètres issus du catalogue ;
5. résumé local du flux et permissions dérivées du catalogue ;
6. contexte module/Gateway/accès, limites, avertissements et état du brouillon ;
7. simulation serveur, historique et variables conservés dans des sections distinctes.

Composants existants réutilisés : `SaveBar`, `useDirty`, `ModuleStatusPanel`, `DisclosureCard`, `ConfirmModal`, les composants du kit de formulaires, les états vides/erreur/skeleton, les badges, menus et métadonnées temporelles.

## Brouillon, validation et ordre

- Une baseline sérialisée est mémorisée après le chargement ou la création.
- `useDirty` compare le formulaire courant à cette baseline.
- `SaveBar` reflète les états propre, modifié, en cours, erreur et lecture seule.
- La navigation interne et la fermeture d’onglet sont protégées quand le brouillon est modifié.
- Une erreur de sauvegarde conserve intégralement le formulaire.
- Un succès actualise la baseline et remet le dirty state à zéro.
- Aucune sauvegarde automatique, aucun double envoi et aucun double toast n’ont été ajoutés.
- Les erreurs documentées sont validées localement, en français, liées aux champs et regroupées dans un résumé global quand plusieurs erreurs bloquent.
- Les validations serveur existantes restent actives.

Les conditions et actions sont déplacées avec des boutons Monter/Descendre nommés. Les tableaux sont réordonnés sans reconstruction des éléments : l’ordre visible est celui transmis aux mutations existantes. Une annonce accessible et une restitution de focus suivent les ajouts, suppressions et déplacements. Aucune bibliothèque de drag-and-drop n’a été ajoutée.

## Contrats, capacités et limites

- Endpoints, méthodes HTTP, DTO, mutations, feature flags et structure des payloads sont inchangés.
- Commandes : limite existante de 10 conditions, 5 actions au total, cooldown de 0 à 86 400 secondes et quota actuel de 80 commandes conservés.
- Automatisations : limites existantes de 20 conditions, 20 actions, 5 attentes et 1 à 60 exécutions par minute conservées.
- Les états de permission et lecture seule viennent toujours de la capacité d’écriture existante.
- La dépendance Gateway est affichée seulement pour les commandes mot-clé et pour le module d’automatisation, conformément aux contrats actuels.
- L’activation d’une commande reste l’action dédiée de la liste ; elle n’a pas été inventée dans le contrat d’enregistrement de l’éditeur.
- La duplication d’une automatisation, l’import/export, le journal d’exécution, la simulation serveur et l’historique sont conservés.
- Aucune duplication de commande ni option slash n’est affichée, car ces capacités ne sont pas présentes dans les contrats actuels.
- Le quota d’automatisations actives lié au plan n’étant pas exposé par la réponse de liste/module, l’interface indique que le serveur reste l’autorité sans inventer de valeur.
- Les aperçus et résumés locaux ne prétendent pas reproduire l’exécution Discord. La simulation serveur existante reste une action explicite et séparée.

## Responsive et accessibilité

Le contrôle navigateur couvre 1440, 1024, 390 et 320 px sur les listes et les deux éditeurs. Les 44 contrôles passent, dont l’absence de scroll horizontal aux quatre largeurs.

Les listes desktop sont des tableaux denses ; les vues mobiles utilisent des cartes et gardent les actions accessibles sans survol. Les formulaires emploient labels, fieldsets et légendes, erreurs reliées aux champs, boutons de déplacement nommés, annonces live, focus restitué, confirmations accessibles et états de lecture seule explicites.

## Validation exécutée

| Contrôle | Résultat |
| --- | --- |
| `pnpm --filter @bot/panel check` | OK |
| `pnpm --filter @bot/panel test` | 37 fichiers, 288 tests réussis |
| `pnpm --filter @bot/panel build` | OK |
| `pnpm --filter @bot/panel check:bundle` | OK |
| `pnpm --filter @bot/panel check:csp` | OK, aucun `eval()` ou `new Function()` |
| `git diff --check` | OK |
| scan de secrets ciblé Lot 5C | OK, aucun motif sensible détecté |
| audit navigateur | 44/44 contrôles réussis |

Bundle JS initial :

- avant Lot 5C : 166,3 kB gzip ;
- après Lot 5C : 166,4 kB gzip ;
- budget : 180,0 kB gzip ;
- marge restante : 13,6 kB gzip.

Les écrans restent chargés à la demande. Après le lot, les chunks directs sont notamment : Commandes 3,06 kB gzip, Éditeur de commande 9,51 kB gzip, Automatisations 5,14 kB gzip et Éditeur d’automatisation 7,41 kB gzip.

## Captures

- [Liste Commandes — avant](captures/01-commandes-avant-desktop.png)
- [Liste Commandes — après desktop](captures/02-commandes-apres-desktop.png)
- [Éditeur de commande — desktop](captures/03-editeur-commande-desktop.png)
- [Conditions et actions de commande](captures/04-commande-conditions-actions.png)
- [Aperçu et résumé de commande](captures/05-commande-apercu-resume.png)
- [Dirty state de commande](captures/06-commande-dirty-state.png)
- [Erreur de validation de commande](captures/07-commande-erreur-validation.png)
- [Liste Automatisations — avant](captures/07-automatisations-avant-desktop.png)
- [Liste Automatisations — après desktop](captures/08-automatisations-apres-desktop.png)
- [Éditeur d’automatisation — desktop](captures/09-editeur-automatisation-desktop.png)
- [Résumé du flux d’automatisation](captures/10-automatisation-resume-flux.png)
- [Automatisation en lecture seule](captures/11-automatisation-lecture-seule.png)
- [Éditeur de commande — tablette 1024 px](captures/12-editeur-commande-tablette-1024.png)
- [Éditeur d’automatisation — mobile 390 px](captures/13-editeur-automatisation-mobile-390.png)

## Limites connues

- Pas de sauvegarde automatique.
- Pas de duplication de commande ni de paramètres slash non exposés par le DTO.
- Pas de valeur de quota de plan inventée pour les automatisations.
- L’aperçu de commande utilise une identité de bot générique et des valeurs de démonstration.
- Les résumés sont des projections du brouillon, pas une simulation exacte du runtime.
