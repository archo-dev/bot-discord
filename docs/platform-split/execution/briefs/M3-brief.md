# Brief d'exécution — M3 · Landing commerciale

> Voir aussi : [milestones](../E4-milestones.md#m3--landing-commerciale) · [client](../../03-client-platform.md) · [stratégie commerciale](../../05-plans-and-commercial-strategy.md) · [UX/UI](../../10-ux-ui-direction.md) · [brief M2](./M2-brief.md) · [rapport M2](../reports/M2-report.md)

> ⚠️ **Brief, pas exécution.** Exécution sur `feat/m03-commercial-landing`.

## 1. Contexte

- **Après M2** (`5d0e429`) : shell public additif gardé par flag (`platform.publicSite`, **off par défaut**) ; `PublicLayout` + `PublicHeader`/`PublicNav`/`PublicFooter` ; `LandingContent` (corps de vitrine : hero + modules + réassurance) partagé entre la Landing autonome (rendue sur `/api/me` 401) et la home publique (flag ON) ; stubs `pages/public/PublicStubs.tsx`.
- **Worker/Gateway** : inchangés ; le Worker sert déjà le SPA (`not_found_handling: single-page-application`).
- **But de M3** : transformer `LandingContent` en **vraie landing commerciale** orientée résultats (10 sections), en **réutilisant** les primitives existantes, sans billing, sans prix définitif, sans faux chiffres.

## 2. Objectif utilisateur

Un visiteur non connecté comprend en un coup d'œil **ce qu'Archodev lui apporte** (gagner du temps, protéger, professionnaliser, centraliser), voit un **aperçu crédible des fonctionnalités** et des **trois offres** (Premium mis en avant), et sait **comment commencer** (ajouter le bot / se connecter). Aucune promesse mensongère, aucun chiffre inventé.

## 3. Périmètre (autorisé)

- **Panel uniquement.** Enrichir `LandingContent` en une landing complète composée de **sections modulaires** (`components/public/landing/`).
- **Catalogue présentiel des offres** `lib/plans.ts` (données marketing : nom, positionnement, nb de serveurs, niveau de support, `highlighted` — **sans prix**), réutilisé par M4.
- Réutiliser `MODULE_REGISTRY` (`@bot/shared`) pour l'aperçu des fonctionnalités, et les primitives `Button`/`Icon`/`Wordmark` + tokens `@bot/ui`.
- **SEO technique minimal côté client** : `document.title` + `<meta name="description">` (helper léger), hiérarchie sémantique (un seul `h1`, `h2` par section), landmarks.
- Tests **purs** (catalogue offres, données de sections) + non-régression.

## 4. Hors périmètre (interdit)

- ❌ Billing, checkout, entitlements réels, prix définitifs, prestataire.
- ❌ Page `/pricing` détaillée + comparatif (**M4**), notes de mise à jour réelles (**M5**).
- ❌ Changement Worker/Gateway/Wrangler/D1, dépendance, domaine, migration.
- ❌ Renommage de `packages/panel`, refonte du panel connecté, suppression de routes.
- ❌ Faux témoignages, statistiques/nombres d'utilisateurs ou de serveurs inventés, marques concurrentes en caution.
- ❌ Activation de `platform.publicSite` en production.

## 5. Audit des fichiers réels

| Fichier | Rôle | Décision M3 | Risque |
|---------|------|-------------|--------|
| `packages/panel/src/pages/LandingContent.tsx` | Corps de vitrine (hero/modules/réassurance) | **Réécrire** en composition de sections commerciales | Moyen (surface visible) → réutilise primitives, budget vérifié |
| `packages/panel/src/pages/Landing.tsx` | Vitrine autonome (chrome glow/header/footer) | **Inchangé** (rend `<LandingContent/>`) | Nul |
| `packages/panel/src/layouts/PublicLayout.tsx` + `components/public/*` | Shell public | **Inchangé** ; la home publique bénéficie de la nouvelle landing | Nul |
| `packages/panel/src/App.tsx` | Routage + flag | **Inchangé** (la landing est déjà rendue en 401 et en home publique) | Nul |
| `packages/shared/src/modules.ts` (`MODULE_REGISTRY`) | Registre modules (publicName/description/category/icon) | **Réutiliser** (source de vérité features) | Nul |
| `packages/panel/src/ui/{kit,icons,brand}` | Primitives Nocturne | **Réutiliser** | Nul |
| `packages/panel/test/*` | Tests purs | **Rester verts** + ajouts | Faible |

**Réutilisables** : `Button`, `IconButton`, `Icon` (25 icônes : shield, chart, bolt, users, workflow, trophy, ticket, music, mic, wave, tag, gavel, sliders, command…), `Wordmark`/`Logo`, `MODULE_REGISTRY`, tokens `@bot/ui/theme.css`, `useQuery(["invite"])`.
**Risques de duplication** : le hero/CTA existe déjà dans `LandingContent` → on le refond, pas de doublon. Les données d'offres ne doivent exister qu'à **un** endroit (`lib/plans.ts`) pour être réutilisées en M4.
**À valider plus tard** : textes marketing définitifs, prix (M4/D1), captures/illustrations éventuelles.
**Hors M3** : comparatif détaillé, FAQ d'objections riche, illustrations lourdes.

## 6. Architecture de la landing

- `LandingContent` = `<main>` composant qui **compose** des sections, chacune un composant présentiel pur dans `components/public/landing/` :
  1. `Hero` — promesse + phrase directrice + CTA (Ajouter à mon serveur / Se connecter). **Un seul `h1`.**
  2. `ValueProp` — proposition de valeur (« vendre des résultats »).
  3. `Benefits` — grille de bénéfices (gagner du temps, protéger, professionnaliser, comprendre, centraliser, support) via données `BENEFITS`.
  4. `FeaturesOverview` — aperçu des fonctionnalités depuis `MODULE_REGISTRY` (regroupées par bénéfice/catégorie).
  5. `UseCases` — cas d'usage concrets (données `USE_CASES`).
  6. `Centralized` — mise en avant de la gestion multi-serveurs (Premium/Business).
  7. `PlansTeaser` — présentation **légère** des 3 offres (`lib/plans.ts`), **Premium mis en avant** (`highlighted`), **sans prix** (« Tarifs bientôt » / CTA « Commencer »).
  8. `Trust` — confiance & transparence (isolation par serveur, permissions minimales, statut) — reprend l'esprit de la section réassurance existante, **sans chiffre inventé**.
  9. `FinalCta` — dernier appel à l'action.
  10. Footer — `PublicFooter` (déjà fourni par `PublicLayout`) ; en Landing autonome, le footer existant demeure.
- **Anti-lien-mort flag-off** : les CTA pointent vers `/auth/login` et l'URL d'invite (`/api/invite`) ; la mise en avant des offres utilise une **ancre on-page** (`#offres`) plutôt que `/pricing` (qui, flag off, redirige vers `/`). Le lien vers `/pricing` détaillé est réservé à M4.
- **SEO client** : helper `lib/seo.ts` (`useDocumentMeta({ title, description })`) posant `document.title` et `<meta name="description">` ; nettoyage au démontage.

## 7. Composants

Nouveaux (panel) : `lib/plans.ts`, `lib/seo.ts`, `components/public/landing/{Hero,ValueProp,Benefits,FeaturesOverview,UseCases,Centralized,PlansTeaser,Trust,FinalCta}.tsx` + éventuel `landing/data.ts` (BENEFITS, USE_CASES). `LandingContent.tsx` **réécrit** (composition). Aucun nouvel export `@bot/ui`.

## 8. Responsive

Mobile-first. Grilles `sm:`/`lg:` (déjà le patron du repo). Hero lisible sur mobile, sections en colonne unique → multi-colonnes en `lg`. Cibles tactiles ≥ 44 px. Aucun débordement horizontal (`max-w-6xl`, `px-4`).

## 9. Accessibilité

Un seul `h1` (hero) ; `h2` par section ; `section aria-labelledby` ; contrastes AA (tokens Nocturne) ; `focus-visible` sur tous les liens/boutons ; `prefers-reduced-motion` respecté ; icônes décoratives `aria-hidden` ; l'information n'est jamais portée par la seule couleur.

## 10. Performance

Réutilisation maximale des primitives (aucun asset lourd, aucune image externe, aucune police nouvelle). `LandingContent` reste dans le chunk initial (rendu en 401 sans suspense) ; si le **budget approche 180 KiB**, **lazy-load** `LandingContent` derrière un `Suspense` léger (repli documenté). Aucune dépendance ajoutée.

## 11. Comportement du flag

- `platform.publicSite` **inchangé** (off par défaut). La landing est une **surface marketing publique** rendue indépendamment du flag (401 → Landing autonome ; flag ON → home publique via `PublicLayout`). M3 **n'active ni ne modifie** le flag ni le routage. Les routes `/features`, `/pricing`, `/updates`, `/status` restent des stubs gardés par flag (inchangés en M3).

## 12. Tests

- **Purs** : `lib/plans.test` (catalogue = 3 offres, ids `free|premium|business`, slots 1/3/5, **Premium `highlighted`**, **aucun champ prix**), `landing-data.test` (BENEFITS/USE_CASES non vides, clés stables). 
- **Non-régression** : `public-routes`, `flags-panel`, `navigation`, `lazy-routes` restent verts.
- **Build + budget** ≤ 180 KiB. **Monorepo** : typecheck + Gateway + Worker + Panel. **Worker dry-run**.

## 13. Critères d'acceptation (mesurables)

1. `LandingContent` rend 9 sections + footer, un seul `h1`, `h2` par section.
2. `lib/plans.ts` = 3 offres, Premium `highlighted: true`, **sans prix** ; réutilisable.
3. Aucun faux témoignage/chiffre ; aucune marque concurrente ; aucun prix.
4. Budget ≤ 180 KiB gzip ; aucune dépendance ; aucun changement Worker/Gateway/Wrangler/@bot/ui/@bot/shared.
5. `platform.publicSite` off ; routage/flag inchangés.
6. `pnpm -r check` + toutes suites vertes ; Worker dry-run OK ; `git diff --check` propre.

## 14. Rollback

`git revert` de la plage `master..feat/m03-commercial-landing`. La landing revient à la version M2. Aucune migration/dépendance → revert net.

## 15. Stratégie de commits (Conventional + réf `M3`)

```
feat(panel): plans catalogue + seo meta helper (M3)
feat(panel): commercial landing sections (M3)
feat(panel): compose commercial LandingContent + tests (M3)
```

≤ ~400 lignes de diff significatif par commit ; chaque commit vert. Merge fast-forward après validation.

## 16. Rapport final attendu

`docs/platform-split/execution/reports/M3-report.md` : branche, HEAD initial/final, sections livrées, composants, catalogue offres, réutilisation, budget avant/après, diffstat, hashes, messages de commit, validations, état Git, confirmations (aucun billing/prix/dépendance/Worker/Gateway, flag off, aucun faux chiffre).

---

## Micro-décisions M3 (défauts, confirmables au démarrage)

| # | Question | Défaut |
|---|----------|--------|
| m3.1 | Prix affichés ? | **Non** — « Tarifs bientôt » ; prix = M4/D1 |
| m3.2 | Plan mis en avant | **Premium** (`highlighted`) — décision validée |
| m3.3 | Source features | **`MODULE_REGISTRY`** (pas de liste dupliquée) |
| m3.4 | Lien « offres » | **Ancre on-page `#offres`** (anti-lien-mort flag-off) |
| m3.5 | `LandingContent` lazy ? | **Non** par défaut ; lazy si budget menacé |
| m3.6 | Nouvel export `@bot/ui` ? | **Non** (sections restent applicatives) |
