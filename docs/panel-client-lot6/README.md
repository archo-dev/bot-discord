# Lot 6 — États UX du panel client

## Résultat

Le Lot 6 harmonise les états visibles sans modifier les contrats métier : chargement, erreur, vide, accès, Gateway, quota, module, brouillon et retours de mutation suivent désormais des règles communes. Les pages déjà conformes ont été conservées ; les changements se concentrent sur les écarts recensés dans la [matrice avant/après](audit-matrix.md).

Aucun endpoint, DTO, Worker, service Gateway, schéma ou donnée D1, billing, enforcement ou Developer Studio n’a été modifié. Aucun déploiement n’a été effectué et le Lot 7 n’a pas été commencé.

## Composants consolidés

- `AsyncState` aligne les cinq sorties d’une zone asynchrone : skeleton, erreur, retry, vide et contenu. Il reste volontairement léger et n’englobe ni les requêtes ni leur mise en page.
- `ErrorCard` porte maintenant un titre, un message, un retry en cours, une référence de diagnostic sûre et un mode compact. Il utilise `role="alert"` et ne rend jamais le code ou le payload interne d’une erreur.
- `OperationalState` distingue visuellement et sémantiquement `readonly`, `permission`, `admin`, `gateway`, `quota`, `module` et `info`. Il décrit l’impact, les actions encore possibles et la prochaine action utile.
- `SaveBar` conserve sa garde `beforeunload` et son blocker React Router. L’erreur devient assertive, se replie sans débordement sur mobile et laisse Réinitialiser/Enregistrer disponibles après un échec.
- Les skeletons gardent une géométrie locale, possèdent un nom de chargement et coupent leur animation avec `prefers-reduced-motion`.
- Les toasts identiques sont dédupliqués, pausés au survol comme au focus, fermables au clavier et bornés à trois éléments.
- Les sélecteurs Salon, Rôle et Membre n’interprètent plus une erreur réseau comme une liste vide ; ils affichent une erreur locale et un retry.

## Pages corrigées

### Erreurs de lecture historiques

- Auto-modération : erreur principale visible, retry, erreurs Salons/Rôles locales, lecture seule et Gateway séparées.
- Niveaux : erreur principale, classement isolé via `AsyncState`, rôles secondaires, état vide explicatif et Gateway distincte.
- Vocaux temporaires : erreur principale, lecture seule et indisponibilité Gateway sans bloquer la sauvegarde de configuration.
- Accès panel : distinction entre accès administrateur requis (403), erreur réseau réessayable et erreur de chargement des rôles.

### Sources secondaires et écriture fail-safe

Les éditeurs Commande/Automatisation, les listes Commandes/Automatisations et les workspaces Bienvenue, Starboard, Tickets et Musique affichent les erreurs secondaires dans leur zone. Lorsqu’une capacité de module ne peut pas être vérifiée, les mutations concernées sont neutralisées ; l’absence de réponse n’est plus interprétée comme une permission accordée.

Le Dashboard conserve ses erreurs par bloc et ajoute une boundary dédiée au widget dense : une exception de rendu secondaire ne retire plus l’en-tête ni le shell de navigation.

### Mutations critiques

- Sauvegardes, restauration et import affichent une erreur persistante ; les modules et correspondances choisis restent en place.
- Les presets conservent leur prévisualisation après un échec d’application.
- Confidentialité conserve la valeur serveur précédente et le message de feedback saisi.
- Les mutations gérées par une SaveBar utilisent `silentError` pour ne pas produire le même message dans un toast.
- Les actions ponctuelles ou temps réel gardent un toast bref lorsque cela suffit.

## Permission, Gateway, quota et module

- Lecture seule : provient du rôle panel et laisse le contenu consultable.
- Permission insuffisante : correspond à un prérequis Discord ou une capacité refusée par le registre.
- Administrateur requis : concerne explicitement la gestion des accès au panel.
- Gateway : décrit l’impact temps réel et n’empêche pas une sauvegarde indépendante du runtime.
- Quota : indique sa nature, l’usage et la limite uniquement quand ils existent dans le frontend. Aucun prix ou usage n’est inventé.
- Module : reprend le registre existant et dirige vers Modules ou Santé lorsque cette route est pertinente.

## Dirty state

Les pages à brouillon continuent d’utiliser une projection stable, `useDirty` et `SaveBar`. Le brouillon reste sale après une erreur ; il ne revient à l’état propre qu’après une réponse confirmée et la resynchronisation de la baseline. Les doubles soumissions sont neutralisées pendant `pending`. Réinitialiser restaure la dernière valeur serveur connue.

La SaveBar reste absente des actions temps réel Musique et des mutations ponctuelles sans brouillon.

## Error boundaries

- racine : conservée dans `main.tsx` ;
- route et chunk lazy : conservés dans `App.tsx` et `GuildLayout.tsx` ;
- zones Modules/Automatisations/Abonnement : conservées ;
- widget secondaire : ajout autour de la grille dense du Dashboard.

Les erreurs de programmation continuent donc d’aboutir à une boundary avec diagnostic ; elles ne sont jamais converties en faux état vide.

## Fichiers du Lot 6

### Créés

- `packages/panel/src/ui/async-state.tsx`
- `packages/panel/test/ux-states.test.ts`
- `docs/panel-client-lot6/audit-matrix.md`
- `docs/panel-client-lot6/browser-audit.json`
- `docs/panel-client-lot6/captures/*.png`

### Modifiés

- infrastructure : `src/lib/queryClient.ts`, `src/ui/kit/feedback.tsx`, `src/ui/kit/forms.tsx`, `src/ui/entity-select.tsx`, `src/ui/error-boundary.tsx`, `src/ui/savebar.tsx`, `src/ui/skeleton.tsx`, `src/ui/toast.tsx`
- pages : `Automod.tsx`, `Levels.tsx`, `TempVoice.tsx`, `PanelAccess.tsx`, `Backup.tsx`, `BackupImport.tsx`, `Onboarding.tsx`, `OnboardingPresets.tsx`, `Privacy.tsx`
- pages refondues avec écarts secondaires : `CommandEditor.tsx`, `Commands.tsx`, `AutomationEditor.tsx`, `Automations.tsx`, `Welcome.tsx`, `Starboard.tsx`, `Tickets.tsx`, `Music.tsx`, `VoiceLog.tsx`, `Modules.tsx`, `Dashboard.tsx`
- mutation locale : `components/MusicSearchPanel.tsx`

## Accessibilité et responsive

Les erreurs critiques utilisent `role="alert"` ; les informations opérationnelles non urgentes utilisent `role="status"`. Les messages ne dépendent pas uniquement de la couleur, les boutons retry sont nommés, les contenus longs utilisent un retour à la ligne et les actions restent clavier/tactiles. La SaveBar et les toasts conservent un ordre de lecture logique.

L’audit navigateur couvre 1440, 1024, 768, 390 et 320 px. Les 26 contrôles passent, notamment :

- aucun scroll horizontal aux cinq largeurs ;
- message long contenu à 320 px ;
- deux actions SaveBar accessibles sur mobile ;
- toast unique, fermable et non masquant ;
- retry réussi sans rechargement de page ;
- shimmer désactivé sous `prefers-reduced-motion`.

Le harnais local montait les vrais composants React du panel sans donnée utilisateur ni appel backend. Il a été supprimé après génération des preuves.

## Validation exécutée

| Contrôle | Résultat |
| --- | --- |
| `pnpm --filter @bot/panel check` | OK |
| `pnpm --filter @bot/panel test` | 39 fichiers, 314 tests réussis |
| `pnpm --filter @bot/panel build` | OK |
| `pnpm --filter @bot/panel check:bundle` | OK |
| `pnpm --filter @bot/panel check:csp` | OK, aucun `eval()` ou `new Function()` |
| `git diff --check` | OK |
| scan de secrets ciblé Lot 6 | OK, aucun motif sensible détecté |
| audit navigateur | 26/26 contrôles réussis |

Bundle JS initial :

- avant Lot 6 (fin Lot 5D) : 166,4 kB gzip ;
- après Lot 6 : 167,0 kB gzip ;
- variation : +0,6 kB gzip ;
- budget : 180,0 kB gzip ;
- marge restante : 13,0 kB gzip.

## Captures

- [Matrice d’audit](captures/01-matrice-audit.png)
- [Erreur de lecture](captures/02-erreur-lecture.png)
- [Erreur de mutation et brouillon conservé](captures/03-erreur-mutation.png)
- [État vide](captures/04-etat-vide.png)
- [Lecture seule](captures/05-lecture-seule.png)
- [Permission insuffisante](captures/06-permission-insuffisante.png)
- [Gateway indisponible](captures/07-gateway-indisponible.png)
- [Quota atteint](captures/08-quota-atteint.png)
- [Module désactivé](captures/09-module-desactive.png)
- [SaveBar desktop](captures/10-savebar-desktop.png)
- [SaveBar mobile](captures/11-savebar-mobile.png)
- [Toast mobile](captures/12-toast-mobile.png)
- [Retry réussi](captures/13-retry-reussi.png)
- [Message long à 320 px](captures/14-mobile-message-long-320.png)

## Limites connues et besoins API séparés

- Tickets et Musique n’exposent pas l’usage courant de leurs quotas sur ces pages. Le frontend indique seulement la limite contractuellement connue ; afficher un compteur exact nécessiterait une donnée API séparée, non ajoutée dans ce lot.
- Le frontend neutralise les actions quand une capacité est inconnue, mais ne remplace jamais l’enforcement serveur existant.
- La Gateway et les permissions affichées restent celles des DTO et du registre actuels ; aucun nouveau diagnostic runtime n’a été inventé.
- Les prix ou liens d’abonnement ne sont jamais ajoutés à un quota lorsque le billing n’est pas activé et accessible.

## Confirmation de périmètre

Le diff du workspace reste limité au panel frontend, à ses tests et à sa documentation pour l’ensemble des lots validés. Le Lot 6 n’ajoute ni backend, ni Worker, ni Gateway, ni DTO, ni migration, ni D1, ni billing, ni enforcement, ni Developer Studio. Il ne supprime aucune fonctionnalité. Aucun déploiement n’a été lancé.
