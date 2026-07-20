# Rapport de fin de milestone — M5 · Notes de mise à jour publiques

> Brief : [../briefs/M5-brief.md](../briefs/M5-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m5--notes-de-mise-à-jour-publiques) · Modèle : [../../08-data-model.md#release_notes](../../08-data-model.md#release_notes)

## Résumé

M5 est **terminé et vert**. Le stub `/updates` est remplacé par un **vrai système de notes de mise à jour** : table D1 `release_notes` (migration additive `0032`), **API publique en lecture seule** (`GET /api/updates`, `GET /api/updates/:slug`) qui n'expose **que** les notes publiées, dans la fenêtre, `audience='all'` — brouillons, programmés, archivés, publications futures et notes ciblées `plan:*` restant **invisibles** ; page liste `/updates` (filtre par module, états vide/chargement/erreur), page détail partageable `/updates/:slug`, et un aperçu « Dernières mises à jour » sur la landing **gardé par flag** (nul en production). Aucun prix, aucun billing, aucune dépendance, **aucune migration distante**, aucun déploiement ; flag `platform.publicSite` off.

- **Branche** : `feat/m05-release-notes`
- **HEAD initial** (master) : `859f681` (brief M5)
- **HEAD final** : `918f925`

## Livré

### Modèle de données — migration `0032_release_notes.sql` (additive)
Table `release_notes` alignée sur [doc 08](../../08-data-model.md#release_notes), minimale pour M5 (pas de tables satellites) :
- Colonnes : `id, slug (UNIQUE), version, title, summary, body_md, sections_json, module_tags_json, audience, status, publish_at, published_at, author, created_at, updated_at, archived_at`.
- Contraintes : `status IN ('draft','scheduled','published','archived')` ; `audience = 'all' OR audience LIKE 'plan:%'` ; `status != 'scheduled' OR publish_at IS NOT NULL` ; `slug` unique.
- Index : `idx_release_notes_public (status, published_at DESC)`, `idx_release_notes_publish_at (publish_at)`.
- **Global** (aucun `guild_id`) : contenu produit public → **aucune surface inter-guilde**. Aucun SQL destructif.

### API publique (lecture seule, hors session)
Sur `publicRouter` (`api/public.ts`, monté hors `/api` gardé) :
- `GET /api/updates?page=&pageSize=&module=` → `ReleaseNotesListResponse` (`Paginated<ReleaseNoteSummary>` + `modules[]`). Query validée par zod (`page ≥1`, `pageSize 1–50`, `module` `^[a-z0-9-]{1,32}$`) ; forme invalide → **400** ; module inconnu valide → liste vide.
- `GET /api/updates/:slug` → `ReleaseNoteDetail` ; slug non publié/inconnu → **404** indifférencié (pas d'énumération).
- **Prédicat de visibilité en SQL** : `status='published' AND published_at IS NOT NULL AND published_at <= now AND audience='all'`.
- **Aucun champ interne** sérialisé (`author`, `status`, `publish_at`, `audience`, timestamps, `id`).
- `Cache-Control: public, max-age=60` ; filtre module par LIKE sur JSON **quoté** (pas de collision `mod`/`moderation`).

### DTO `@bot/shared` (`api-types/release-notes.ts`)
`ReleaseNoteChangeType`, `RELEASE_NOTE_CHANGE_TYPES`, `ReleaseNoteSection`, `ReleaseNoteSummary`, `ReleaseNoteDetail`, `ReleaseNotesListResponse` (réutilise `Paginated<T>`).

### Panel
- **`pages/public/Updates.tsx`** (lazy) : en-tête, filtre par module (puces `aria-pressed`), cartes (date FR, badge version, titre lien, résumé, badges de catégories), états **chargement** (Skeleton) / **erreur** (ErrorCard + réessayer) / **vide** (EmptyState honnête). Un seul `<main>`/`<h1>`.
- **`pages/public/UpdateDetail.tsx`** (lazy) : détail par `slug` (corps `bodyMd`, sections nouveautés/améliorations/corrections/sécurité) ; 404 → « Note introuvable ».
- **`pages/public/updates-format.ts`** : helpers **purs** (labels FR, teintes, date, options de filtre).
- **`components/public/landing/LatestUpdates.tsx`** : aperçu 3 notes, **rendu uniquement si `platform.publicSite` ON** (nul + aucun fetch en prod), `null` si vide/erreur/chargement (robuste, n'invente rien).
- **Câblage** : `App.tsx` route `/updates` → page dédiée + **nouvelle route `/updates/:slug`** ; `UpdatesPage` retiré de `PublicStubs.tsx` ; `lib/public-routes.ts` reconnaît `/updates/:slug` comme public (préfixe).

## Décision de flag (M5.7)
**Réutilisation de `platform.publicSite`** — pas de nouveau flag ni de câblage flag Worker. L'API est lecture seule et **inerte par défaut** (aucune note publiée → liste vide) ; la page `/updates` et l'aperçu landing sont déjà gardés par `platform.publicSite` (off en prod). Rollback = flag off (page + section masquées), conforme à E4 M5. Documenté et testé (taxonomie off/on, rendu conditionnel de la landing).

## Fichiers (17 · +933 / −10)

```
 packages/worker/migrations/0032_release_notes.sql              | +39
 packages/shared/src/api-types/release-notes.ts                 | +46
 packages/shared/src/api-types/index.ts                         | +1
 packages/worker/src/db/queries/release-notes.ts                | +151
 packages/worker/src/db/queries.ts                              | +1
 packages/worker/src/api/public.ts                              | +141/-…
 packages/panel/src/pages/public/Updates.tsx                    | +133
 packages/panel/src/pages/public/UpdateDetail.tsx               | +96
 packages/panel/src/pages/public/updates-format.ts              | +47
 packages/panel/src/components/public/landing/LatestUpdates.tsx | +63
 packages/panel/src/pages/LandingContent.tsx                    | +7
 packages/panel/src/pages/public/PublicStubs.tsx                | -4 (retrait stub)
 packages/panel/src/App.tsx                                     | +3 (repoint + route détail)
 packages/panel/src/lib/public-routes.ts                        | +4 (préfixe /updates)
 packages/worker/test/release-notes.test.ts                     | +157
 packages/panel/test/public-routes.test.ts                      | +10
 packages/panel/test/updates-format.test.ts                     | +37
```

**Non touchés** : Gateway, `@bot/ui`, `wrangler.jsonc`, `package.json`, lockfile, `index.ts` (le routeur public portait déjà le montage), catalogue de flags.

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 5/5 |
| Tests panel | ✅ **80 / 16 fichiers** (avant M5 : 74/15) |
| Tests Gateway | ✅ 207 (baseline, non touché) |
| Tests Worker — `release-notes` | ✅ **12/12** (isolé) ; `release-notes + onboarding` ✅ |
| Build panel + budget | ✅ **152.5 kB / 180 kB** (marge 27.5) |
| Chunk `/updates` lazy | ✅ `Updates-*.js` 1.63 kB gzip (séparé) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check master..HEAD` | ✅ propre |
| Migration `0032` sur base propre | ✅ (appliquée via `readD1Migrations` par la suite worker) |

> **Limitation d'environnement (baseline)** : la suite Worker **complète** en un seul run est instable sur ce poste (refus `ConnectEx` loopback du fallback service vitest-pool-workers, **zéro échec d'assertion**). Les suites passent **par lots** ; la nouvelle suite `release-notes` (sans `fetchMock`) passe de façon fiable (12/12).

## Budget bundle (avant / après)

| | Total gzip JS initial | Budget | Marge |
|---|---|---|---|
| Avant (M4) | 151.7 kB | 180.0 kB | 28.3 kB |
| Après (M5) | **152.5 kB** | 180.0 kB | 27.5 kB |

+0.8 kB : l'aperçu landing `LatestUpdates` entre dans le chunk initial (la landing y vit) ; les pages `/updates` et `/updates/:slug` sont **code-split** (hors initial).

## Commits

| Hash | Message |
|------|---------|
| `859f681` | `docs(platform): M5 execution brief` (poussé seul sur `master` avant la branche) |
| `7a67973` | `feat(worker): add public release notes API and storage (M5)` |
| `d7d7db3` | `feat(panel): add public release notes experience (M5)` |
| `918f925` | `test(platform): cover release notes publication rules (M5)` |

## Sécurité (confirmations)
- Backend = source de vérité : visibilité en SQL, jamais côté client.
- Aucune fuite de brouillon / programmé / archivé / futur / `plan:*` / champ interne (couvert par test).
- Slug non public → 404 indifférencié (pas d'énumération).
- Aucune donnée par-guilde → **aucun risque inter-guilde ni d'escalade**. Aucune session, aucune PII.
- Entrées validées (zod), réponses bornées (liste sans `body_md`).

## Confirmations
- **Aucun déploiement** · **aucune migration distante** (`0032` locale uniquement) · **aucune dépendance / lockfile** · **aucun changement Gateway / `@bot/ui` / `wrangler.jsonc` / domaine / secret** · **flag `platform.publicSite` off** · **aucun prix, aucun billing, aucun checkout, aucune interface de création** · aucun faux historique ; M6 non commencé au moment de ce rapport.

## Rollback
- **Fonctionnel** : `platform.publicSite` off → `/updates` et aperçu landing absents ; API inerte (aucune note publiée).
- **Code** : `git revert` de la plage `master..feat/m05-release-notes`. Migration `0032` **additive** (table nouvelle, vide) → un revert de code la laisse inutilisée ; **aucun `DROP`**, aucune donnée détruite.
