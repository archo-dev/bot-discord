# Rapport de fin de milestone — M2 · Shell public & couche de routes publiques

> Brief : [../briefs/M2-brief.md](../briefs/M2-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md) · Git : [../E6-branching-strategy.md](../E6-branching-strategy.md)

## Résumé

M2 est **terminé et vert**. Une couche publique **additive et gardée par flag** est introduite côté panel, **sans toucher l'app connectée, le Worker, la Gateway, `@bot/ui`, `@bot/shared` ni les dépendances**. **Flag OFF (défaut, production) ⇒ comportement identique à master.** Quand `platform.publicSite` est ON (dev/preview uniquement), un shell public (en-tête + navigation + pied de page) sert des pages placeholder sans session.

- **Branche** : `feat/m02-public-shell`
- **HEAD initial** (master) : `1c0eabe8febaa89361e07c0c349534f65eb9db40`
- **HEAD final** : `7d289843378fc056d673361a96b28ddc682edff6`

## Architecture retenue

- **Décision de routage pure & testable** : `packages/panel/src/lib/public-routes.ts` (`PUBLIC_PATHS`, `isPublicPath`, `resolveShell`). Flag OFF → toujours `connected` ; flag ON → `public` / `root` / `connected`.
- **Source de flag build-time** : `packages/panel/src/lib/flags.ts` lit `VITE_PLATFORM_PUBLIC_SITE` via Vite et s'appuie sur `resolveFlags` de `@bot/shared` (M1). **Off par défaut**, aucun branchement backend (réversible).
- **Câblage `App.tsx`** : branche publique **additive** — court-circuit des chemins publics **avant** la gate `["me"]` (indépendants de la session) ; racine déconnectée → home publique quand le flag est ON. Les blocs sont des **conditions mortes** quand le flag est OFF → comportement inchangé.
- **Shell public** (nouveau, dans le panel) : `layouts/PublicLayout.tsx`, `components/public/{PublicHeader,PublicNav,PublicFooter}.tsx`. `PublicHeader` lit `["me"]` (401 → « Se connecter », succès → « Ouvrir le panel »), menu mobile repliable (Échap).
- **`LandingContent`** extrait de `Landing.tsx` (corps hero/modules/réassurance), partagé entre la Landing autonome (flag OFF / 401, chrome inchangé) et la home publique (flag ON). **Rendu flag-off identique.**
- **Pas de changement Worker** : `wrangler.jsonc` a déjà `not_found_handling: "single-page-application"` → les nouveaux chemins publics sont servis par le fallback SPA.

## Décision de source de flag

**Build-time Vite** (`VITE_PLATFORM_PUBLIC_SITE="true"`), retenu pour : zéro changement backend, réversibilité maximale, off par défaut (variable absente en prod). Le branchement runtime (vars Worker → `/api/me`) reste **différé** (M2-brief §10).

## Taxonomie / resolveShell

- `PUBLIC_PATHS = ["/features","/pricing","/updates","/status"]` + préfixe `/legal`.
- `resolveShell(path, {publicSite})` : `false` → `connected` partout ; `true` → `public` (chemins dédiés), `root` (`/`), `connected` (reste). Couvert par tests purs.

## Composants publics créés

`PublicLayout` (header + Outlet/children + footer, sans `<main>` propre), `PublicHeader` (marque + `PublicNav` + état de connexion + menu mobile), `PublicNav` (NavLink, actif `aria-current`), `PublicFooter` (liens légaux/statut), `PublicStubs` (Features/Pricing/Updates/Status/Legal — placeholders, **aucun prix inventé**), `LandingContent` (corps de vitrine partagé). Le shell public est **code-split** (chunks lazy `PublicLayout-*.js`, `PublicStubs-*.js`) → hors bundle initial.

## Fichiers (12 · +493 / −96)

```
 packages/panel/src/App.tsx                          |  65 +++++++-
 packages/panel/src/components/public/PublicFooter.tsx |  17 ++
 packages/panel/src/components/public/PublicHeader.tsx |  66 +++++++++
 packages/panel/src/components/public/PublicNav.tsx  |  33 +++++
 packages/panel/src/layouts/PublicLayout.tsx         |  24 +++
 packages/panel/src/lib/flags.ts                     |  29 +++
 packages/panel/src/lib/public-routes.ts             |  39 +++++
 packages/panel/src/pages/Landing.tsx                | 102 +----------
 packages/panel/src/pages/LandingContent.tsx         | 106 ++++++++++++
 packages/panel/src/pages/public/PublicStubs.tsx     |  52 ++++++
 packages/panel/test/flags-panel.test.ts             |  19 ++
 packages/panel/test/public-routes.test.ts           |  37 +++++
```

**Non touchés** : `packages/worker/*`, `packages/gateway/*`, `packages/ui/*`, `packages/shared/*`, `package.json`, `pnpm-lock.yaml`, `migrations/*`, `wrangler.jsonc`, `main.tsx`.

## Validations (toutes vertes)

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo | ✅ |
| Tests taxonomie/flag (panel, ciblés) | ✅ 8 |
| Tests panel (complets) | ✅ 12 fichiers / 61 (baseline 10/53) |
| Tests Gateway | ✅ 24 / 207 |
| Tests Worker | ✅ 41 / 289 |
| Build Gateway | ✅ |
| Build panel | ✅ |
| Worker `wrangler deploy --dry-run` | ✅ (exit 0) |
| `git diff --check master..HEAD` | ✅ propre |
| Chunks publics code-split | ✅ `PublicLayout-*.js`, `PublicStubs-*.js` |

## Budget bundle (avant / après)

| | Total gzip JS initial | Budget | Marge |
|---|---|---|---|
| Avant (master) | 148.6 kB | 180.0 kB | 31.4 kB |
| Après (M2, flag off) | **149.4 kB** | 180.0 kB | 30.6 kB |

+0.8 kB (helpers routage/flag + wrappers lazy) ; shell public **hors** bundle initial (lazy).

## Compatibilité OAuth

`/auth/*` **inchangé**. « Se connecter » → `/auth/login` ; callback → `/` (worker). Flag OFF : redirections/gate identiques. Deep links publics servis par le fallback SPA. Retour vers route initiale post-login : hors M2 (conservé tel quel).

## Commits

| Hash | Message |
|------|---------|
| `50a41b2086e904c4353cfad5db28abd42bdb5475` | `test(panel): characterization + public route taxonomy (M2)` |
| `0f8f83d69bebee717022e3ded7f02728f4d9a75c` | `feat(panel): platform.publicSite flag source (build-time, off default) (M2)` |
| `b603b9ccb23ab2aaec931ac9f9613201b3f84d75` | `feat(panel): public layout & shell (header/nav/footer, LandingContent) (M2)` |
| `7d289843378fc056d673361a96b28ddc682edff6` | `feat(panel): public route stubs behind flag + App wiring (M2)` |

## Auto-audit

1. Additif & gardé par flag ✅ · 2. Flag OFF = comportement master ✅ · 3. URLs existantes préservées ✅ · 4. Aucun renommage de package ✅ · 5. Aucun changement Worker/Gateway/@bot/ui/@bot/shared/dép/migration ✅ · 6. `LandingContent` rendu flag-off identique ✅ · 7. Shell public code-split, budget tenu ✅ · 8. Aucun prix inventé (stub pricing) ✅ · 9. `platform.publicSite` off en prod (aucun `.env`) ✅ · 10. Décision de routage pure & testée ✅.

## Confirmations

- **Aucun déploiement** · **aucune migration** (dernière = `0031`) · **aucune dépendance / lockfile** · **aucun changement Worker/Gateway/`wrangler`/secrets** · **flag off en production** · aucun domaine custom · M3 non commencé.

## Rollback

`git revert` de la plage `master..feat/m02-public-shell` (branche isolée). Flag off par défaut → aucune surface publique active à désactiver.

## Reste à faire (hors M2)

Landing commerciale (M3), pricing réel (M4), notes de mise à jour (M5), branchement runtime du flag si nécessaire.
