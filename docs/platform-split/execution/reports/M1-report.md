# Rapport de fin de milestone — M1 · Fondations & design system

> Brief : [../briefs/M1-brief.md](../briefs/M1-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md) · Git : [../E6-branching-strategy.md](../E6-branching-strategy.md)

## Résumé

M1 est **terminé et vert**. Le socle commun est posé sans aucun risque produit : package `@bot/ui` amorcé (TS brut, calqué sur `@bot/shared`), tokens du design system « Nocturne » extraits et partagés, première primitive (`Badge`) migrée, et mécanisme de **feature flags** de plateforme introduit (désactivés par défaut). Le panel est **fonctionnellement identique** et le budget bundle est **respecté** (même légèrement réduit).

- **Branche** : `feat/m01-foundations`
- **HEAD initial** (master) : `9a1f675ff9ffbfad21a9aca2e8cc0b4d83975814`
- **HEAD final** : `ae981badd325095eff80373b85f394e316ab12ee`

## Architecture retenue

- `@bot/ui` = package **TS brut** (`exports: { ".": "./src/index.ts", "./theme.css": "./src/theme/tokens.css" }`), `check = tsc --noEmit`, **React en `peerDependency`**, `@types/react`/`typescript` en devDeps — cohérent avec `@bot/shared`. Bundlé par le consommateur (aucune étape de build propre).
- **Tokens** : source canonique dans `packages/ui/src/theme/tokens.css`, importée par le panel via `@import "@bot/ui/theme.css";` + `@source "../../ui/src";` (pour que Tailwind v4 scanne les composants partagés).
- **Primitive** : `Badge` vit dans `@bot/ui` ; le kit du panel (`ui/kit/feedback.tsx`) la **ré-exporte** → aucun doublon, les 15 pages consommatrices passent transitivement par `@bot/ui`, imports inchangés.
- **Flags** : dans `@bot/shared` (`src/flags.ts`) — frontière partagée worker/panel/gateway.

## Spike Tailwind v4 — RÉUSSI ✅

Hypothèse testée : déplacer `@theme` + `:root` dans `@bot/ui` et les `@import` depuis le panel conserve-t-il le fonctionnement de Tailwind v4 ?

**Preuve mesurée** (CSS généré du build panel) :
- Remap `@theme` présent : `#16141f` (zinc-900), `#6b4ef2` (iris), `#0c0a11` (bg-app).
- Tokens sémantiques présents : `--surface-1`, `--primary`, `--aurora`, `--text-eyebrow`, `--shadow-primary`.
- Classes de la primitive générées : `bg-indigo-950`, `text-indigo-200`, `bg-green-950`, `bg-amber-950`, `bg-red-950`, `bg-zinc-800`.
- Aucune duplication : `@theme`/tokens **absents** de `index.css`, présents **uniquement** dans `tokens.css`.
- Budget **identique** (voir ci-dessous).

**Fallback** : non nécessaire (le repli « garder les tokens dans le panel » documenté au brief §Lot B n'a pas été utilisé).

## Primitive extraite

`Badge` (pastille d'état, design_system §5.5) — présentationnelle pure (`ReactNode` + classes Tailwind), sans routeur/accès/domaine. Markup et classes **identiques** à l'original. Exposé avec un mapping pur `badgeToneClass(tone)` pour un test sans DOM.

## Feature flags ajoutés

Catalogue typé `PLATFORM_FLAGS` (`platform.publicSite`, `platform.entitlements`, `platform.billing`), tous **`default: false`**. Résolveur pur `resolveFlags(source)` + `isFlagEnabled(key, source)` : clés inconnues et valeurs non booléennes ignorées (retour au défaut, jamais de crash). **Aucun flag n'active de fonctionnalité produit** ; branchement réel reporté à M2+.

## Fichiers (13 · +382 / −166)

```
 packages/panel/package.json            |   1 +
 packages/panel/src/index.css           | 150 +------------------------
 packages/panel/src/ui/kit/feedback.tsx |  25 ++----
 packages/panel/test/flags.test.ts      |  39 +++++++
 packages/panel/test/ui-badge.test.ts   |  23 +++++
 packages/shared/src/flags.ts           |  69 ++++++++++++
 packages/shared/src/index.ts           |   1 +
 packages/ui/package.json               |  20 ++++
 packages/ui/src/index.ts               |   8 ++
 packages/ui/src/primitives/badge.tsx   |  33 ++++++
 packages/ui/src/theme/tokens.css       | 154 +++++++++++++++++++++++++
 packages/ui/tsconfig.json              |   9 ++
 pnpm-lock.yaml                         |  16 +++
```

Lockfile : **additions uniquement** (`@bot/ui` link + son entrée) ; **aucune version de dépendance existante modifiée**.

## Validations (toutes vertes)

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 5/6 projets |
| Tests `@bot/ui` (via panel, ciblés) | ✅ 2 |
| Tests flags (via panel, ciblés) | ✅ 5 |
| Tests panel (complets) | ✅ 10 fichiers / 53 (baseline 8/46) |
| Tests Gateway (complets) | ✅ 24 / 207 |
| Tests Worker (complets) | ✅ 289 |
| Build Gateway | ✅ |
| Build panel | ✅ |
| Worker `wrangler deploy --dry-run` | ✅ |
| `git diff --check` | ✅ propre |

## Budget bundle (avant / après)

| | Total gzip JS initial | Budget | Marge |
|---|---|---|---|
| Avant (master) | 148.7 kB | 180.0 kB | 31.3 kB |
| Après (M1) | **148.6 kB** | 180.0 kB | 31.4 kB |

Aucune régression ; légère baisse (−0.1 kB).

## Commits

| Hash | Message |
|------|---------|
| `c5ca045b491c4c2a02d5b9a7b5865bd032ec9729` | `chore(ui): scaffold shared ui package (M1)` |
| `1b9773c05ae5d08f49888fde28d75d072a28c08d` | `refactor(ui): extract shared tokens and primitive (M1)` |
| `ae981badd325095eff80373b85f394e316ab12ee` | `feat(ui): add typed feature flag foundations (M1)` |

## Auto-audit (10 points)

1. `@bot/ui` minimal ✅ · 2. React en peer ✅ · 3. tokens réellement partagés (spike OK, pas de fallback) ✅ · 4. aucune régression Tailwind v4 ✅ · 5. une seule primitive extraite proprement ✅ · 6. le panel l'utilise réellement ✅ · 7. flags typés + off par défaut ✅ · 8. aucun comportement produit changé ✅ · 9. budget respecté ✅ · 10. aucune migration/domaine/route/fonction SaaS ✅.

## Confirmations

- **Aucun déploiement** · **aucun push** · **aucune migration D1** (dernière = `0031`) · **aucun domaine** · **aucune fonctionnalité SaaS implémentée** · aucun renommage de package · aucun fichier interdit modifié (worker/src, gateway/src, wrangler, systemd, secrets intacts).

## Rollback

`git revert` de la plage `master..feat/m01-foundations` (branche isolée). Fonctionnellement neutre : flags off par défaut → rien à désactiver.

## Reste à faire (hors M1)

- Extraction incrémentale d'autres primitives (au fil des besoins), branchement réel des flags (M2+). Aucune dette introduite.
