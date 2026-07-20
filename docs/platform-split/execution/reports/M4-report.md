# Rapport de fin de milestone — M4 · Pricing & comparatif des offres

> Brief : [../briefs/M4-brief.md](../briefs/M4-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md) · Git : [../E6-branching-strategy.md](../E6-branching-strategy.md)

## Résumé

M4 est **terminé et vert**. La route `/pricing` sert désormais une **vraie page pricing** (cartes d'offres, comparatif détaillé, bascule mensuel/annuel, FAQ d'objections) à la place du stub — **sans aucun prix** (« Tarifs à venir »), sans billing, sans checkout. Page **code-split** (chunk lazy) → **bundle initial inchangé**. Aucune dépendance, aucun changement Worker/Gateway/`@bot/ui`/`@bot/shared` ; flag `platform.publicSite` off.

- **Branche** : `feat/m04-pricing`
- **HEAD initial** (master) : `fff72ff4b27aeb71ae77135d729761777ff6f85e`
- **HEAD final** : `de1c405906c07653b9cada2290429438cca549a9`

## Livré

- **`pages/public/Pricing.tsx`** (lazy) : en-tête + phrase directrice, **toggle mensuel/annuel** (`SegmentedControl`, structurel), `PricingCards`, `ComparisonTable`, `PricingFaq`. Un seul `<main>`, un seul `h1`.
- **Cartes** : 3 offres depuis `lib/plans.ts`, **Premium recommandé**, prix = **« Tarifs à venir »**, CTA « Commencer » → `/auth/login`.
- **Comparatif** : matrice 10 lignes × 3 offres (issue de [doc 05](../../05-plans-and-commercial-strategy.md)), table accessible (`<th scope>`), défilement horizontal **isolé** sur mobile.
- **FAQ d'objections** : 6 questions véridiques (`DisclosureCard`), aucune fausse promesse, aucun prix.
- **`PlanBadge`** : badge d'offre réutilisable (utilisé dans les en-têtes du comparatif ; réutilisable en M8).
- **Câblage** : `App.tsx` route `/pricing` → page dédiée ; `PricingPage` retiré de `PublicStubs.tsx` (pas de doublon). Aucune route supprimée.

## Données (chunk lazy, hors bundle initial)

`components/public/pricing/data.ts` : `PLAN_COMPARISON` (matrice), `FAQ_ITEMS`, `BILLING_PERIODS`/`BillingPeriod` — **aucun prix, aucune remise chiffrée**.

## Réutilisation

`PLAN_TIERS` (M3), `SegmentedControl`, `DisclosureCard`, `Button`, `Icon`, `Badge`→`PlanBadge`, tokens. Aucun nouvel export `@bot/ui`.

## Fichiers (9 · +284 / −5)

```
 packages/panel/src/App.tsx                                   | 1 (repoint)
 packages/panel/src/pages/public/PublicStubs.tsx              | -4 (retrait stub)
 packages/panel/src/pages/public/Pricing.tsx                  | +
 packages/panel/src/components/PlanBadge.tsx                  | +
 packages/panel/src/components/public/pricing/data.ts         | +
 packages/panel/src/components/public/pricing/PricingCards.tsx | +
 packages/panel/src/components/public/pricing/ComparisonTable.tsx | +
 packages/panel/src/components/public/pricing/PricingFaq.tsx  | +
 packages/panel/test/pricing-data.test.ts                     | +
```

**Non touchés** : Worker, Gateway, `@bot/ui`, `@bot/shared`, `package.json`, lockfile, migrations, `wrangler.jsonc`, `PublicLayout`/header/nav/footer, landing.

## Validations (toutes vertes)

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo | ✅ |
| Tests panel | ✅ 15 fichiers / 74 (avant M4 : 14/69) |
| Tests Gateway | ✅ 24 / 207 |
| Tests Worker | ✅ 41 / 289 |
| Build Gateway | ✅ |
| Build panel + budget | ✅ 151.7 kB / 180 kB |
| Chunk pricing lazy | ✅ `Pricing-*.js` (séparé) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check master..HEAD` | ✅ propre |
| Aucun prix / € / % dans pricing | ✅ |

## Budget bundle (avant / après)

| | Total gzip JS initial | Budget | Marge |
|---|---|---|---|
| Avant (M3) | 151.6 kB | 180.0 kB | 28.4 kB |
| Après (M4) | **151.7 kB** | 180.0 kB | 28.3 kB |

+0.1 kB (négligeable) : la page pricing et ses données sont **code-split** → bundle initial ≈ inchangé, comme prévu.

## Commits

| Hash | Message |
|------|---------|
| `f2a04b4265678a606b42c5e14937b8f9b8116711` | `feat(panel): pricing comparison data + PlanBadge (M4)` |
| `64a18229b0a0b5ee3d0990bfb882a96af777e7d9` | `feat(panel): pricing page (cards, comparison, monthly/annual, FAQ) (M4)` |
| `de1c405906c07653b9cada2290429438cca549a9` | `refactor(panel): route /pricing to dedicated page + drop stub (M4)` |

## Confirmations

- **Aucun déploiement** · **aucune migration** · **aucune dépendance / lockfile** · **aucun changement Worker/Gateway/Wrangler/D1/@bot/ui/@bot/shared** · **flag off** · **aucun prix, aucun billing, aucun checkout** · aucun faux témoignage/chiffre ; M5 non commencé.

## Rollback

`git revert` de la plage `master..feat/m04-pricing` → `/pricing` redevient le stub. Aucune migration/dépendance.
