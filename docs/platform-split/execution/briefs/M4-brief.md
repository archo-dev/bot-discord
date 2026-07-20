# Brief d'exécution — M4 · Pricing & comparatif des offres

> Voir aussi : [milestones](../E4-milestones.md#m4--pricing--comparatif-des-offres) · [stratégie commerciale](../../05-plans-and-commercial-strategy.md) · [client](../../03-client-platform.md) · [E7 décisions](../E7-decision-queue.md) · [brief M3](./M3-brief.md)

> ⚠️ **Brief, pas exécution.** Exécution sur `feat/m04-pricing`.

## 1. Contexte

- **Après M3** : `LandingContent` = landing commerciale ; `lib/plans.ts` = catalogue présentiel des 3 offres (`free|premium|business`, slots 1/3/5, positionnements, support, `highlighted: premium`), **sans prix**. `/pricing` est encore un **stub** (`pages/public/PublicStubs.tsx > PricingPage`) rendu sous `PublicLayout` quand `platform.publicSite` est ON.
- **But de M4** : remplacer le stub par une **vraie page pricing** — cartes d'offres, **comparatif détaillé**, bascule **mensuel/annuel** (structure prête, **valeurs placeholders**), **FAQ d'objections**. **Aucun prix définitif**, aucun checkout, aucun billing.

## 2. Objectif utilisateur

Un visiteur compare clairement les trois offres (périmètre par fonctionnalité), comprend la progression Gratuit → Premium → Business (**Premium recommandé**), voit la structure mensuel/annuel, et trouve des réponses à ses objections — **sans qu'aucun prix ne soit inventé** (« Tarifs à venir »).

## 3. Périmètre (autorisé)

- **Panel uniquement.** Page `pages/public/Pricing.tsx` (remplace le stub), composée de : cartes d'offres (réutilisent `lib/plans.ts`), **table de comparatif**, **toggle mensuel/annuel** (`SegmentedControl`), **FAQ** (`DisclosureCard`).
- **Données de comparatif** dans `components/public/pricing/data.ts` (**chunk lazy pricing**, hors bundle initial) : matrice fonctionnalités × offres (issue de [doc 05](../../05-plans-and-commercial-strategy.md)), `FAQ_ITEMS`, type `BillingPeriod`. **Aucun prix.**
- `components/PlanBadge.tsx` — petit badge d'offre réutilisable (Gratuit/Premium/Business).
- **Câblage** : repointer l'import lazy `PricingPage` d'`App.tsx` vers la nouvelle page ; retirer le `PricingPage` stub de `PublicStubs.tsx` (pas de doublon).
- Tests **purs** (matrice, FAQ) + non-régression.

## 4. Hors périmètre (interdit)

- ❌ Prix définitifs, remise annuelle chiffrée, prestataire, checkout, billing, entitlements réels.
- ❌ Changement Worker/Gateway/Wrangler/D1, dépendance, domaine, migration.
- ❌ Renommage `packages/panel`, refonte du panel connecté, suppression de route, activation du flag en prod.
- ❌ Faux témoignages/chiffres, marques concurrentes en caution, notes de mise à jour réelles (M5).

## 5. Audit des fichiers réels

| Fichier | Rôle | Décision M4 | Risque |
|---------|------|-------------|--------|
| `packages/panel/src/pages/public/PublicStubs.tsx` | Stubs publics (dont `PricingPage`) | **Retirer** `PricingPage` (déplacé vers page dédiée) | Faible |
| `packages/panel/src/App.tsx` | Routage public (lazy `PricingPage`) | Repointer l'import vers `pages/public/Pricing.js` | Faible (1 ligne) |
| `packages/panel/src/lib/plans.ts` | Catalogue offres (M3) | **Réutiliser** (cartes) ; comparatif vit ailleurs (lazy) | Nul |
| `packages/panel/src/ui/kit/segmented.tsx` (`SegmentedControl<T>`) | Contrôle segmenté générique | **Réutiliser** (toggle période) | Nul |
| `packages/panel/src/ui/disclosure.tsx` (`DisclosureCard`) | Accordéon | **Réutiliser** (FAQ) | Nul |
| `packages/ui/src/primitives/badge.tsx` (`Badge`) | Badge Nocturne | **Réutiliser** (base de `PlanBadge`) | Nul |

**Réutilisables** : `PLAN_TIERS`, `SegmentedControl`, `DisclosureCard`, `Badge`, `Button`, `Icon`, tokens. **Duplication à éviter** : les données d'offres restent dans `lib/plans.ts` ; le comparatif détaillé (données pricing) dans `pricing/data.ts` (lazy).

## 6. Architecture

- **`pages/public/Pricing.tsx`** (lazy, sous `PublicLayout`) : SEO meta, en-tête, `SegmentedControl` mensuel/annuel (état local `BillingPeriod`), `PricingCards`, `ComparisonTable`, `PricingFaq`. **Un seul `<main>`, un seul `h1`.**
- **Toggle mensuel/annuel honnête** : l'état bascule une étiquette de période ; les prix affichent **« Tarifs à venir »** dans les deux cas (aucune valeur, aucune remise chiffrée). La structure est **prête à recevoir** les prix (D1) sans réinventer l'UI.
- **Budget** : la page pricing et ses données sont **code-split** (route publique lazy) → **bundle initial inchangé**. `lib/plans.ts` (déjà en initial via la landing) n'est **pas** alourdi (le comparatif vit dans `pricing/data.ts`).
- **Flag** : `platform.publicSite` inchangé (off par défaut) ; `/pricing` reste une route publique gardée par flag.
- **Anti-lien-mort** : CTA des cartes → `/auth/login` (« Commencer »).

## 7. Composants

Nouveaux : `pages/public/Pricing.tsx`, `components/public/pricing/{data.ts, PricingCards.tsx, ComparisonTable.tsx, PricingFaq.tsx}`, `components/PlanBadge.tsx`. Modifiés : `App.tsx` (1 import), `PublicStubs.tsx` (retrait `PricingPage`). Aucun nouvel export `@bot/ui`.

## 8. Responsive

Cartes en colonne unique → 3 colonnes en `lg`. **Table de comparatif** : conteneur `overflow-x-auto` dédié sur mobile (jamais de débordement de page) ; en-têtes d'offres collants optionnels. Toggle accessible au tactile. FAQ pleine largeur.

## 9. Accessibilité

Un `h1` ; `h2` par section ; table avec `<th scope>` (lignes = fonctionnalités, colonnes = offres) ; `SegmentedControl` au clavier (déjà géré par le kit) ; `DisclosureCard` avec `aria-expanded` ; contrastes AA ; information jamais portée par la seule couleur (ex. « — » explicite pour absence).

## 10. Performance

Route lazy → hors bundle initial (budget ≤ 180 KiB **inchangé**). Aucun asset lourd, aucune dépendance. Vérifier que le budget reste identique (le pricing ne doit pas entrer dans le chunk initial).

## 11. Comportement du flag

`platform.publicSite` **off par défaut**. `/pricing` rendu uniquement flag ON (via `App.tsx`, inchangé sur ce point). M4 ne modifie ni le flag ni la logique de garde ; il remplace seulement l'élément rendu par la route `/pricing`.

## 12. Tests

- **Purs** : `pricing-data.test` — matrice = 3 colonnes (`free/premium/business`), lignes cohérentes (dont Serveurs 1/3/5), **aucun prix/€**, FAQ non vide sans fausse promesse ; `plan-badge`/`plans` restent verts.
- **Non-régression** : `public-routes`, `flags-panel`, `plans`, `landing-data`, `navigation`, `lazy-routes` verts.
- **Build + budget** : initial **≤ 180 KiB et ≈ inchangé** (pricing lazy). **Monorepo** + **Worker dry-run**.

## 13. Critères d'acceptation (mesurables)

1. `/pricing` (flag ON) rend cartes + comparatif + toggle + FAQ ; **Premium recommandé** ; **aucun prix** (« Tarifs à venir »).
2. `PricingPage` stub retiré de `PublicStubs.tsx` ; `App.tsx` pointe vers la page dédiée ; aucune route supprimée.
3. Comparatif = matrice fonctionnalités × 3 offres, cohérente avec [doc 05](../../05-plans-and-commercial-strategy.md), sans prix.
4. **Budget initial inchangé** (pricing code-split) ; aucune dépendance ; aucun changement Worker/Gateway/`@bot/ui`/`@bot/shared`.
5. Flag off ; `pnpm -r check` + suites vertes ; Worker dry-run OK ; `git diff --check` propre.

## 14. Rollback

`git revert` de la plage `master..feat/m04-pricing` → `/pricing` redevient le stub. Aucune migration/dépendance.

## 15. Stratégie de commits (Conventional + réf `M4`)

```
feat(panel): pricing comparison data + PlanBadge (M4)
feat(panel): pricing page (cards, comparison, monthly/annual, FAQ) (M4)
refactor(panel): route /pricing to dedicated page + drop stub + tests (M4)
```

Chaque commit vert ; ≤ ~400 lignes ; merge fast-forward après validation.

## 16. Rapport final attendu

`docs/platform-split/execution/reports/M4-report.md` : sections livrées, données comparatif, réutilisation, **budget avant/après (initial inchangé)**, diffstat, hashes, commits, validations, confirmations (aucun prix/billing/dépendance/Worker/Gateway, flag off).

---

## Micro-décisions M4 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m4.1 | Prix affichés ? | **Non** — « Tarifs à venir » ; toggle structurel |
| m4.2 | Remise annuelle chiffrée ? | **Non** (D2/D1 ouvertes) — étiquette de période seule |
| m4.3 | Emplacement données comparatif | **`pricing/data.ts` (lazy)** — bundle initial inchangé |
| m4.4 | `PlanBadge` | Petit composant réutilisable (base `@bot/ui` Badge) |
| m4.5 | Nouvel export `@bot/ui` ? | **Non** |
