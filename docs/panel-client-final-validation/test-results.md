# Résultats des validations

Exécution finale du 28 juillet 2026.

| Commande / contrôle | Résultat |
|---|---|
| `pnpm --filter @bot/panel check` | Réussi |
| `pnpm --filter @bot/panel test` | Réussi — 40 fichiers, **322/322 tests** |
| `pnpm --filter @bot/panel build` | Réussi — 922 modules |
| `pnpm --filter @bot/panel check:bundle` | Réussi — 167,2/180 kB gzip |
| `pnpm --filter @bot/panel check:csp` | Réussi — aucun `eval()` ou `new Function()` |
| `git diff --check` | Réussi |
| scan de secrets | Réussi — aucun motif connu détecté dans le périmètre |
| smoke routes navigateur | Réussi — 75 contrôles |
| matrice responsive navigateur | Réussi — 56 contrôles |
| profils/permissions navigateur | Réussi — 12 contrôles |
| interactions navigateur | Réussi — 9 contrôles |
| captures navigateur | Réussi — 23 contrôles |

Total navigateur : **175 contrôles**.

## Interactions contrôlées

- drawer ouvert, focus interne, body verrouillé, fermeture Échap, focus restitué ;
- recherche ouverte au clavier, champ focalisé, deux groupes, quatre résultats pour « roles » ;
- Entrée vers la page Rôles, Échap et restitution du focus ;
- boutons 7/30/90 jours, période 90 jours sélectionnée ;
- favori persistant après rechargement ;
- SaveBar sur formulaire modifié ;
- préférence de réduction des animations reconnue.

## Tests disponibles

Le package ne déclare pas de script `lint` distinct. Il ne fournit pas non plus de commande axe/Pa11y autonome. Les contrôles TypeScript, Vitest, CSP, bundle, routes, accessibilité structurelle et smoke navigateur disponibles ont tous été exécutés.

## Données et sécurité

- Aucune fixture de validation n'est importée dans `packages/panel`.
- Aucun secret connu détecté.
- Aucun fichier backend ou d'infrastructure modifié.
- Aucun endpoint ou DTO ajouté.
- Aucun déploiement, merge ou push.
