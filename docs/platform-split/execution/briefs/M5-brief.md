# Brief d'exécution — M5 · Notes de mise à jour publiques

> Voir aussi : [milestones](../E4-milestones.md#m5--notes-de-mise-à-jour-publiques) · [modèle de données](../../08-data-model.md#release_notes) · [sécurité](../../09-security-model.md) · [client](../../03-client-platform.md) · [brief M2](./M2-brief.md) · [brief M4](./M4-brief.md)

> ⚠️ **Brief, pas exécution.** Décrit **quoi faire** en M5. Exécution sur branche `feat/m05-release-notes` après commit + push de ce brief sur `master`.

## 1. Contexte

- **Après M2–M4** : shell public (`PublicLayout`) + routes publiques gardées par `platform.publicSite` (off par défaut). `/updates` est encore un **stub** (`pages/public/PublicStubs.tsx > UpdatesPage`, « Bientôt disponible »). Aucune donnée dynamique publique n'existe : le seul endpoint public est `GET /api/invite` (`packages/worker/src/api/public.ts`, monté à `/` **hors** sous-app `/api` gardée par session).
- **But de M5** : remplacer le stub par un **vrai système de notes de mise à jour**, alimenté par **D1** et exposé par une **API publique en lecture seule**. Page `/updates` (liste), page détail `/updates/:slug`, filtrage par module, réutilisation légère des dernières notes sur la landing. **Aucune interface de création** (la publication éditoriale complète = Studio, M12) : les données de test viennent de **fixtures/helpers**, jamais de faux historique en production.

## 2. Objectif utilisateur

Un visiteur (sans compte) consulte les nouveautés du produit : liste de versions publiées (date, version, titre, résumé, badges de catégories), filtre par module, et une vue détaillée partageable par `slug`. Réassurance « produit vivant ». **Aucune note inventée** : en l'absence de note publiée, la page affiche un état vide honnête.

## 3. Périmètre (autorisé)

- **Migration D1 `0032_release_notes`** (additive, locale uniquement) : table `release_notes`.
- **`@bot/shared`** : DTO `api-types/release-notes.ts` (résumé + détail + réponse liste), réexporté dans `api-types/index.ts`.
- **Worker** : `db/queries/release-notes.ts` (SQL brut, lecture publiée uniquement) ; extension de `api/public.ts` avec `GET /api/updates` et `GET /api/updates/:slug` (lecture seule, hors session).
- **Panel** : page `pages/public/Updates.tsx` (liste + filtre), `pages/public/UpdateDetail.tsx` (détail `/updates/:slug`), section légère « Dernières mises à jour » sur la landing (gardée par flag), câblage `App.tsx`, retrait du stub `UpdatesPage`, ajout de `/updates/:slug` à la taxonomie publique (`lib/public-routes.ts`).
- **Tests** : suite worker `release-notes` (règles de publication, auto-suffisante), tests panel purs (taxonomie, helpers de formatage), non-régression.

## 4. Hors périmètre (interdit)

- ❌ Interface développeur de **création/édition/publication** (Studio M12) ; toute route de **mutation** publique.
- ❌ Faux historique commercial présenté comme réel ; **seed distant** ; injection de notes en production.
- ❌ Billing, entitlements, Studio, prix, prestataire, checkout.
- ❌ Migration **distante** (`migrate:remote`), déploiement Worker/Gateway, secret, dépendance, lockfile, renommage de package, changement de domaine.
- ❌ Activation d'une offre payante ; changement du comportement de production de la landing (voir §Flag & §Landing).

## 5. Audit des fichiers réels

| Fichier | Rôle actuel | Décision M5 | Risque |
|---------|-------------|-------------|--------|
| `packages/worker/migrations/` (dernier `0031`) | Migrations D1 additives | **Créer `0032_release_notes.sql`** | Faible (additif) |
| `packages/worker/src/api/public.ts` | `GET /api/invite` (hors session) | **Étendre** : `GET /api/updates`, `/api/updates/:slug` | Faible |
| `packages/worker/src/db/queries/` + barrel `queries.ts` | SQL brut par domaine | **Ajouter** `release-notes.ts` + réexport | Faible |
| `packages/worker/src/index.ts` | Monte `publicRouter` à `/` avant `/api` gardé | **Inchangé** (le routeur public porte déjà les nouvelles routes) | Nul |
| `packages/shared/src/api-types/{index,common}.ts` | DTOs + `Paginated<T>` | **Ajouter** `release-notes.ts`, réutiliser `Paginated` | Nul |
| `packages/panel/src/pages/public/PublicStubs.tsx` | Stubs (dont `UpdatesPage`) | **Retirer** `UpdatesPage` (page dédiée) | Faible |
| `packages/panel/src/App.tsx` | Routage public gardé par flag | Repointer `UpdatesPage` + **ajouter** `/updates/:slug` | Faible |
| `packages/panel/src/lib/public-routes.ts` | `isPublicPath`/`resolveShell` (purs) | **Étendre** : `/updates/...` = public (préfixe, comme `/legal`) | Faible → tests |
| `packages/panel/src/pages/LandingContent.tsx` | Corps de la landing (rendu **aussi en prod**) | **Ajouter** section « Dernières mises à jour » **gardée par flag** (nulle en prod) | Moyen → gardée par flag + fallback nul |
| `packages/panel/src/ui/kit.js`, `lib/seo.ts` | `SegmentedControl`, `useDocumentMeta` | **Réutiliser** | Nul |

## 6. Modèle de données — `release_notes` (migration `0032`)

Aligné sur [doc 08 §release_notes](../../08-data-model.md#release_notes), **minimal pour M5** (pas de tables satellites) :

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | interne |
| `slug` | TEXT NOT NULL **UNIQUE** | identifiant public stable (URL) |
| `version` | TEXT (nullable) | affichage ; **non unique** (une note peut ne pas être versionnée ; hotfix) |
| `title` | TEXT NOT NULL | |
| `summary` | TEXT (nullable) | résumé liste |
| `body_md` | TEXT (nullable) | corps markdown (détail) |
| `sections_json` | TEXT (nullable) | `[{type:'new'|'improved'|'fixed'|'security', items:[…]}]` — **validé applicativement** en lecture |
| `module_tags_json` | TEXT (nullable) | `["automod","music",…]` — filtre par module |
| `audience` | TEXT NOT NULL DEFAULT `'all'` | `all` \| `plan:<id>` ; **seul `all` est public** en M5 |
| `status` | TEXT NOT NULL DEFAULT `'draft'` | CHECK `IN ('draft','scheduled','published','archived')` |
| `publish_at` | TEXT (nullable) | programmation ; CHECK `status!='scheduled' OR publish_at IS NOT NULL` |
| `published_at` | TEXT (nullable) | date de publication effective (tri + fenêtre) |
| `author` | TEXT (nullable) | opérateur — **interne, jamais exposé** |
| `created_at` | TEXT NOT NULL DEFAULT `datetime('now')` | |
| `updated_at` | TEXT NOT NULL DEFAULT `datetime('now')` | |
| `archived_at` | TEXT (nullable) | |

**Contraintes / index** :
- `slug` UNIQUE (index implicite).
- `CHECK (status IN (...))`, `CHECK (audience = 'all' OR audience LIKE 'plan:%')`, `CHECK (status != 'scheduled' OR publish_at IS NOT NULL)`.
- Index `idx_release_notes_public ON (status, published_at DESC)` (requête liste publique).
- Index `idx_release_notes_publish_at ON (publish_at)` (balayage programmation futur).
- **Aucun SQL destructif** ; migration **additive**, rétrocompatible, **locale uniquement**.

**Prédicat de visibilité publique (source de vérité backend)** :
```
status = 'published' AND published_at IS NOT NULL AND published_at <= :now AND audience = 'all'
```
→ brouillon, programmé, archivé, publication future, ciblage `plan:*` = **jamais** publics.

## 7. API publique (lecture seule, hors session)

Sur `publicRouter` (`api/public.ts`), déjà monté hors `/api` gardé :

- **`GET /api/updates`** → liste paginée des notes publiques.
  - Query (zod strict) : `page` (≥1, défaut 1), `pageSize` (1–50, défaut 10), `module` (slug `^[a-z0-9-]{1,32}$`, optionnel — **whitelist de forme** ; module inconnu mais valide → liste vide, jamais 500).
  - Réponse : `ReleaseNotesListResponse` = `Paginated<ReleaseNoteSummary>` + `modules: string[]` (tags distincts des notes publiées, pour l'UI de filtre).
  - **Aucun** champ interne (`author`, `status`, `publish_at`, `created_at`, `audience`).
- **`GET /api/updates/:slug`** → détail d'une note **publiée**.
  - `slug` non publié / inconnu → **404 `not_found`** (aucune distinction brouillon/inexistant : pas de fuite d'existence).
  - Réponse : `ReleaseNoteDetail` (résumé + `bodyMd` + `sections`).
- **Cache** : `Cache-Control: public, max-age=60` (contenu marketing, faible volatilité) — compatible (routes JSON `/api/*` indépendantes du cache d'assets).
- **Rate limiting** : s'appuie sur l'infra Cloudflare existante (comme `/api/invite`) ; **pas** de limiteur applicatif ajouté (lecture publique inerte). Documenté.
- **Pas** d'API de mutation publique (création = Studio M12).

DTO (`@bot/shared/api-types/release-notes.ts`) :
```ts
type ReleaseNoteChangeType = "new" | "improved" | "fixed" | "security";
interface ReleaseNoteSection { type: ReleaseNoteChangeType; items: string[]; }
interface ReleaseNoteSummary {
  slug: string; version: string | null; title: string; summary: string | null;
  moduleTags: string[]; changeTypes: ReleaseNoteChangeType[]; publishedAt: string; // ISO
}
interface ReleaseNoteDetail extends ReleaseNoteSummary { bodyMd: string | null; sections: ReleaseNoteSection[]; }
interface ReleaseNotesListResponse extends Paginated<ReleaseNoteSummary> { modules: string[]; }
```

## 8. Frontend `/updates`

- **`pages/public/Updates.tsx`** (lazy, sous `PublicLayout`) : `useDocumentMeta`, en-tête, filtre par module (puces « Tous » + modules issus de `modules`), liste de cartes (date FR, `version` en badge, titre, résumé, badges de catégories via `changeTypes`), **états** vide / chargement (`Skeleton`) / erreur (message compréhensible, bouton réessayer). Un seul `<main>`, un seul `h1`. Liens `/updates/:slug` (partageables).
- **`pages/public/UpdateDetail.tsx`** (lazy) : détail par `slug` (titre, date, version, corps `bodyMd`, sections nouveautés/améliorations/corrections/sécurité). 404 → état « note introuvable » + retour `/updates`.
- **Helpers purs** `pages/public/updates-format.ts` (labels FR des catégories, formatage date, dérivation des puces de filtre) → **testables en node**.
- **Data-fetching** : `useQuery` + `api<…>("/api/updates?…")` (react-query déjà en bundle). Pages lazy → **hors bundle initial** (budget inchangé).
- **Responsive 320 px**, navigation clavier, contrastes AA, information jamais portée par la seule couleur (catégories = texte + couleur).

## 9. Réutilisation sur la landing

- Composant léger `components/public/landing/LatestUpdates.tsx` dans `LandingContent`, **rendu uniquement si `platform.publicSite` est ON** (via `getPlatformFlags()`), donc **nul en production** (flag off) → **zéro changement du comportement de la landing prod** (aucun rendu, aucun fetch).
- Sur `publicSite` ON : `useQuery("/api/updates?pageSize=3")` ; **rendu `null`** si liste vide / erreur / chargement (fallback discret, ne casse jamais la landing, n'invente aucun contenu).

## 10. Feature flag (décision M5.7)

**Décision : réutiliser `platform.publicSite`** ; **pas** de nouveau flag ni de câblage flag côté Worker.
- **Justification** : (1) l'API `/api/updates` est **lecture seule** et ne renvoie que des notes **publiées** ; sans note publiée (défaut prod) elle renvoie une liste **vide** → surface inerte, aucune donnée sensible. (2) La **page** `/updates` et la section landing sont déjà **gardées par `platform.publicSite`** (off en prod) → invisibles en production. (3) Le **rollback** = `platform.publicSite` off (page + section masquées), conforme à [E4 M5 « Rollback : flag masquant /updates »](../E4-milestones.md#m5--notes-de-mise-à-jour-publiques). (4) Ajouter un flag Worker impliquerait un `[vars]` wrangler + un lecteur de flag serveur (nouvelle mécanique, hors périmètre M5, complexifie les tests) pour un gain de sécurité nul (endpoint inerte).
- **Testé** : la taxonomie (`resolveShell` off/on) et le rendu conditionnel de la section landing restent couverts ; l'API publiée/non-publiée est couverte côté worker.
- **`platform.entitlements`** (déjà au catalogue) reste réservé à **M6**.

## 11. Sécurité

- **Backend = source de vérité** : le prédicat de visibilité est appliqué **en SQL** ; l'UI ne filtre jamais seule.
- **Aucune fuite** de brouillon / programmé / archivé / futur / `plan:*` / champ interne (`author`, `status`, `publish_at`, `created_at`, `audience`).
- **Pas d'énumération** : slug non public → 404 indifférencié.
- **Multitenant** : `release_notes` est **global** (pas de `guild_id`) — contenu produit public, aucune donnée par-guilde, donc **aucun risque inter-guilde**. Aucune session, aucune donnée utilisateur.
- **Entrées validées** (zod) : `page`/`pageSize` bornés, `module` whitelisté par forme ; corps de réponse borné (liste = résumés sans `body_md`).
- **CSRF** : routes **GET** idempotentes uniquement ; `browserMutationOrigin` (déjà global `/api/*`) n'impacte pas les GET.

## 12. Tests

**Worker — `test/release-notes.test.ts`** (SQL/D1 réel, **sans `fetchMock`** → fiable ; chaque test **auto-suffisant**, piège rollback vitest-pool-workers) :
1. note publiée (audience `all`, `published_at` passé) → visible en liste **et** en détail ;
2. brouillon → absent de la liste + slug → 404 ;
3. programmé (`scheduled`) → invisible ;
4. publication future (`published_at > now`) → invisible ;
5. archivé → invisible ;
6. `audience = 'plan:premium'` → invisible ;
7. slug inconnu → 404 ;
8. pagination (`total` exact, bornes `pageSize`, `page`) ;
9. filtre `module` invalide (forme) → 400 ; module inconnu valide → liste vide ;
10. **aucun champ interne** dans les réponses (`author`/`status`/`publish_at`/`created_at`/`audience` absents) ;
11. `modules` = tags distincts des **seules** notes publiées.

**Panel (purs, node)** :
- `public-routes` : `isPublicPath("/updates/xxx")` → true ; non-régression `/updates`, `/legal/*`, `resolveShell` off/on.
- `updates-format` : labels FR des catégories, formatage date, dérivation des puces de filtre.
- Non-régression : `navigation`, `lazy-routes`, `flags-panel`, `landing-data`, `pricing-data`.

**Validations monorepo** : `pnpm -r check` ; panel/gateway verts ; suites worker concernées vertes (exécutées **par lots** — limitation loopback connue du poste, cf. baseline) ; **build panel + budget ≤ 180 KiB** ; `wrangler deploy --dry-run` ; `git diff --check`.

## 13. Critères d'acceptation

1. `0032_release_notes` s'applique sur base propre ; table + index + contraintes présents ; **additif**.
2. `GET /api/updates` / `/api/updates/:slug` renvoient **uniquement** des notes publiées, dans la fenêtre, `audience='all'`, **sans champ interne** ; slug non public → 404.
3. `/updates` (flag ON) : liste + filtre module + états vide/chargement/erreur ; `/updates/:slug` : détail ; liens partageables.
4. Landing : section « Dernières mises à jour » **nulle en prod** (flag off), robuste (nulle si vide/erreur) en dev.
5. Flag `platform.publicSite` off → `/updates` et section landing **absents** (comportement identique à `master`).
6. **Budget initial ≤ 180 KiB** (pages `/updates` lazy) ; aucune dépendance ; aucun changement Gateway/domaine/secret ; **aucune migration distante**, aucun déploiement.
7. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 14. Rollback

- **Fonctionnel** : `platform.publicSite` off → aucune surface `/updates` active ; API inerte (aucune note publiée).
- **Code** : `git revert` de la plage `master..feat/m05-release-notes`. Migration `0032` **additive** (table nouvelle) ; un revert de code laisse la table inutilisée et vide (aucune donnée détruite) — **jamais** de `DROP` en rollback.

## 15. Migrations locales

- `pnpm run migrate:local` applique `0032` sur la D1 **locale** de dev ; les tests worker appliquent toutes les migrations via `readD1Migrations` (base propre par run). **Aucun** `migrate:remote`.

## 16. Stratégie de commits (Conventional + réf `M5`, ordre `CLAUDE.md`)

```
docs(platform): M5 execution brief                                  # poussé seul sur master AVANT la branche
feat(worker): add public release notes API and storage (M5)         # migration + shared DTO + queries + api
feat(panel): add public release notes experience (M5)               # pages /updates + détail + landing + câblage
test(platform): cover release notes publication rules (M5)          # worker + panel tests
docs(platform): M5 completion report
```
Chaque commit vert ; merge **fast-forward** après validation.

## 17. Rapport final attendu

`docs/platform-split/execution/reports/M5-report.md` : livré, modèle de données, API, décision de flag, réutilisation, budget avant/après, diffstat, hashes, commits, validations, confirmations (aucun prix/billing/dépendance/déploiement/migration distante ; flag off en prod ; aucune fuite de champ interne).

---

## Micro-décisions M5 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m5.1 | Flag dédié ? | **Non** — réutilise `platform.publicSite` (endpoint inerte par défaut) |
| m5.2 | Chemins API | **`/api/updates`, `/api/updates/:slug`** (alignés E4, cohérents avec `/updates`) |
| m5.3 | `version` unique ? | **Non** — `slug` est la clé publique stable |
| m5.4 | Vue détail | **Route dédiée `/updates/:slug`** (lien partageable) plutôt qu'accordéon |
| m5.5 | Note programmée échue | **Invisible** tant que `status != 'published'` (transition = Studio M12) |
| m5.6 | Réutilisation landing | **Oui, gardée par flag** (nulle en prod), `null` si vide/erreur |
| m5.7 | Nouvel export `@bot/ui` ? | **Non** |
