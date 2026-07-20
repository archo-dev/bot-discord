# Rapport de fin de milestone — M3 · Landing commerciale

> Brief : [../briefs/M3-brief.md](../briefs/M3-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md) · Git : [../E6-branching-strategy.md](../E6-branching-strategy.md)

## Résumé

M3 est **terminé et vert**. `LandingContent` est transformé en **landing commerciale** orientée résultats (9 sections + footer), composée de composants présentiels réutilisant les primitives Nocturne et `MODULE_REGISTRY`. **Aucun prix, aucun chiffre inventé, aucun témoignage, aucune marque concurrente.** Aucune dépendance, aucun changement Worker/Gateway/`@bot/ui`/`@bot/shared` ; flag `platform.publicSite` inchangé (off).

- **Branche** : `feat/m03-commercial-landing`
- **HEAD initial** (master) : `691732d40d23bfd07c3d06dfe5e49a3f5d3c8d3c`
- **HEAD final** : `6de515d0d4e5e05da71782d44fc5d4516227f836`

## Sections livrées

1. **Hero** (un seul `h1`, promesse + CTA « Ajouter à mon serveur » via `/api/invite` + « Voir les offres » ancre) · 2. **ValueProp** · 3. **Benefits** (6, orientés résultats) · 4. **FeaturesOverview** (modules depuis `MODULE_REGISTRY`) · 5. **UseCases** (3 cas concrets) · 6. **Centralized** (multi-serveurs Premium/Business) · 7. **PlansTeaser** (3 offres, **Premium recommandé**, « Tarifs à venir ») · 8. **Trust** (isolation/permissions/contrôle) · 9. **FinalCta** · 10. **Footer** (`PublicFooter`, inchangé).

## Composants & données

- `lib/plans.ts` — catalogue présentiel des offres (`free|premium|business`, slots 1/3/5, positionnements & support validés, `highlighted: premium`), **sans prix** ; réutilisable en M4.
- `lib/seo.ts` — `useDocumentMeta` (title + `<meta name="description">`, restauré au démontage).
- `components/public/landing/{data.ts, Hero.tsx, PlansTeaser.tsx, sections.tsx}` — sections présentielles.
- `pages/LandingContent.tsx` — composition (un seul `<main>`), partagée Landing autonome (401) ⇄ home publique (flag ON).

## Réutilisation

`Button`/`Icon`/`Wordmark` + tokens `@bot/ui/theme.css`, `MODULE_REGISTRY` (source de vérité des fonctionnalités), `useQuery(["invite"])`. Aucun nouvel export `@bot/ui`, aucune image externe, aucune police nouvelle.

## Fichiers (9 · +517 / −94)

```
 packages/panel/src/lib/plans.ts                          | +
 packages/panel/src/lib/seo.ts                            | +
 packages/panel/src/components/public/landing/data.ts     | +
 packages/panel/src/components/public/landing/Hero.tsx    | +
 packages/panel/src/components/public/landing/PlansTeaser.tsx | +
 packages/panel/src/components/public/landing/sections.tsx | +
 packages/panel/src/pages/LandingContent.tsx              | réécrit
 packages/panel/test/plans.test.ts                        | +
 packages/panel/test/landing-data.test.ts                 | +
```

**Non touchés** : Worker, Gateway, `@bot/ui`, `@bot/shared`, `package.json`, lockfile, migrations, `wrangler.jsonc`, `App.tsx`, `PublicLayout`/header/nav/footer.

## Validations (toutes vertes)

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo | ✅ |
| Tests panel | ✅ 14 fichiers / 69 (baseline 12/61) |
| Tests Gateway | ✅ 24 / 207 |
| Tests Worker | ✅ 41 / 289 |
| Build Gateway | ✅ |
| Build panel + budget | ✅ 151.6 kB / 180 kB |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check master..HEAD` | ✅ propre |
| Aucun prix / € dans landing & plans | ✅ |

## Budget bundle (avant / après)

| | Total gzip JS initial | Budget | Marge |
|---|---|---|---|
| Avant (M2) | 149.4 kB | 180.0 kB | 30.6 kB |
| Après (M3) | **151.6 kB** | 180.0 kB | 28.4 kB |

+2.2 kB (landing dans le chunk initial, rendue en 401 sans suspense). Sous budget → pas de lazy-load nécessaire.

## Commits

| Hash | Message |
|------|---------|
| `295b904f407ad350094be08f501557bc0b5d0f53` | `feat(panel): plans catalogue + seo meta helper (M3)` |
| `da46d17b373f59280caef34dbec1a07a79acc087` | `feat(panel): commercial landing sections (M3)` |
| `6de515d0d4e5e05da71782d44fc5d4516227f836` | `feat(panel): compose commercial LandingContent + tests (M3)` |

## Confirmations

- **Aucun déploiement** · **aucune migration** · **aucune dépendance / lockfile** · **aucun changement Worker/Gateway/Wrangler/D1/@bot/ui/@bot/shared** · **flag `platform.publicSite` off** · aucun billing/prix/checkout · **aucun faux témoignage ni chiffre inventé** · aucune marque concurrente ; M4 non commencé.

## Rollback

`git revert` de la plage `master..feat/m03-commercial-landing` → la landing revient à la version M2. Aucune migration/dépendance.
