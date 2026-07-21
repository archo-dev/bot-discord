# Brief d'exécution — M12 · Studio développeur minimal isolé

> Voir aussi : [milestones](../E4-milestones.md#m12--studio-minimal) · [architecture](../../02-product-architecture.md) · [studio](../../04-developer-studio.md) · [sécurité](../../09-security-model.md) · [données](../../08-data-model.md) · [E2 §6/§7/§8 (D10/D11/D17/D22)](../E2-decision-fiches.md) · [branches](../E6-branching-strategy.md) · [rapport M11](../reports/M11-report.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m12-studio-minimal` après commit + push de ce brief sur `master`. **Studio uniquement — surface d'exploitation, isolée du domaine client, derrière `platform.studio` (off).** Aucun déploiement, aucune migration distante, aucun secret prod, aucune clé live.

## 1. Contexte

- **Après M1–M11** : `@bot/ui` amorcé (M1), moteur d'entitlements `resolveEffectiveEntitlement` + `GET /api/subscription` (M6), slots/gating (M7), espace client `/app/*` (M8), billing sandbox + webhooks signés idempotents (M9/M10), support client priorisé (`support_tickets`/`support_messages`, file `listSupportQueue` prête pour le Studio, M11). Auth client : cookie opaque `session` (KV `sess:`), `sameSite=Lax`, `requireSession` + `requireGuildAccess`. Migrations locales jusqu'à **`0036_support`** ; **`0032`→`0036` non appliquées en prod** ; tous les flags plateforme **off**.
- **But de M12** : livrer le **socle du Studio développeur isolé** — allowlist d'opérateurs vérifiée **serveur**, dev-auth (`requireDeveloper(permission)`), premières routes `/studio-api/*` **lecture** (vue d'ensemble, guildes, abonnements) + publication des notes de mise à jour (consomme M5), et une **SPA Studio minimale**. **Isolation stricte** : domaine distinct (`studio.archodev.fr`), cookie `studio_session` distinct (`sameSite=Strict`), keyspace KV distinct, **aucune route studio sur le domaine client**. Réversible : ne pas router le host studio ⇒ zéro impact client.

## 2. Décisions consommées (défauts documentés, conformes aux docs)

| # | Décision | Choix M12 | Justification |
|---|----------|-----------|---------------|
| m12.1 | **D22** (worker-studio *ou* entry) | **Surface host-gated dans le worker existant** : les routes `/studio-api/*` et `/studio/auth/*` ne répondent **que** si `Host == STUDIO_HOST` ; **404** sur le host client. Binaire déployé séparé = **différé** (concern déploiement, hors scope no-deploy). | Isolation garantie au niveau code + réversible (ne pas router le host) **sans** déploiement ni nouveau binding wrangler. D22 laisse « worker-studio **ou** entry » ouvert. |
| m12.2 | **D17** (domaine studio) | `STUDIO_HOST` (var, défaut logique `studio.archodev.fr`), **non déclarée en prod** ⇒ Studio injoignable par défaut. | Domaine distinct confirmé ([doc 09] §1). |
| m12.3 | **D11** (bootstrap propriétaire) | `STUDIO_OWNER_IDS` (secret, snowflakes séparés par `,`) ⇒ propriétaire = **opérateur `active` implicite, 13 permissions**. **Aucune route publique de bootstrap.** Équipe = table `studio_operators` (gérée en `/settings`, **M13+**). | « provisionné via secret/migration contrôlée, pas via route publique » ([doc 09] §3, E2 Fiche 7.1). |
| m12.4 | Session studio | Cookie `studio_session`, KV `studio:sess:<id>`, **`sameSite=Strict`**, TTL **8 h absolu / 30 min idle**, kill-switch `STUDIO_SESSION_GLOBAL_VERSION` + par-opérateur (réutilise `security:session-generation:`). | [doc 09] §2, E2 Fiche 7.1. |
| m12.5 | Flag | **`platform.studio`** (nouveau catalogue `@bot/shared`, **off**). Off ⇒ tout `/studio*` **404**. | Rollback par flag (E4 M12). |
| m12.6 | Permissions | Matrice **13 permissions** vérifiée **serveur** via `requireDeveloper(permission)`. Lecture par défaut ; mutation = permission explicite + vérif Origin. | [doc 09] §3 matrice. |
| m12.7 | SPA | `packages/developer-studio` (neuf, minimal) : login gate + `ProductionBanner` + Overview/Guildes/Abonnements/Updates. **Non câblée au déploiement** (isolée par domaine, servie plus tard). | [doc 04] direction UX. |

## 3. Hors périmètre (interdit — M13/M14/M15)

- ❌ **Grants manuels / lifetime / révocation / annulation / remboursement** = **M13**. M12 ne mute **aucun** entitlement (abonnements = **lecture seule**).
- ❌ **Audit immuable `audit_events` / step-up / rate-limits par action / kill-switch UI / masquage PII avancé** = **M14**. M12 logge en télémétrie ; pas de nouvelle table d'audit.
- ❌ **Erreurs/métriques/déploiements/rollout par cohortes** = **M15**.
- ❌ Gestion d'équipe (`/settings` mutations d'opérateurs/permissions) au-delà du bootstrap secret = M13+.
- ❌ Nouvelle dépendance importante ; secret prod ; clé live ; migration distante ; déploiement ; migration destructive ; activation de flag en prod ; second binaire wrangler déployé.
- ❌ Toute mutation studio sur les données **payées** (`paid`) : par conception, **aucun droit `revoke_paid`**.

## 4. Modèle de données — migration `0037_studio_operators.sql` (additive, [doc 08])

### `studio_operators`
`user_id` PK (snowflake) · `display_name` (nullable) · `status` (CHECK `active|disabled`, défaut `active`) · `note` (nullable, interne) · `created_at` · `updated_at`.

### `studio_operator_permissions`
`user_id` (FK `studio_operators` ON DELETE CASCADE) · `permission` (CHECK ∈ 13 permissions) · `granted_at` · `granted_by` (nullable) · **PK (`user_id`, `permission`)**. Index `(user_id)`.

**Aucun `INSERT` seed** (le propriétaire vient de `STUDIO_OWNER_IDS`, pas de la migration : pas d'ID codé en dur en base). **Aucun SQL destructif.**

Les 13 permissions (identiques à la matrice [doc 09] §3) : `subscriptions.read`, `subscriptions.grant`, `subscriptions.grant_lifetime`, `subscriptions.revoke_granted`, `subscriptions.cancel_paid`, `subscriptions.refund_paid`, `support.manage`, `guilds.inspect`, `features.manage`, `updates.publish`, `deployments.read`, `deployments.manage`, `audit.read`.

## 5. `@bot/shared`

- `flags.ts` : **`platform.studio`** (catalogue, défaut off).
- `api-types/studio.ts` (pur, exporté via `api-types/index`) :
  - `STUDIO_PERMISSIONS` (const tuple des 13), `StudioPermission` type, `isStudioPermission(x): x is StudioPermission` (garde de validation).
  - DTOs : `StudioSessionInfo` (`operatorId`, `displayName`, `isOwner`, `permissions: StudioPermission[]`), `StudioOverview` (KPIs : `guilds`, `activeEntitlements`, `openTickets` par priorité, `latestUpdate`), `StudioGuildSummary`, `StudioSubscriptionSummary` (plan, source, statut, fenêtre — **aucune PII**), `StudioUpdateSummary` (slug, titre, statut, published_at), `CreateStudioUpdateRequest`, `PublishStudioUpdateRequest`. Réutilise `Paginated<T>`.

## 6. Worker

### Auth studio (isolée, réplique du modèle client)
- `auth/studio-session.ts` : `STUDIO_SESSION_COOKIE='studio_session'`, KV **`studio:sess:<id>`**, `createStudioSession`/`loadStudioSession`/`deleteStudioSession`/`revokeStudioSessions`, `setStudioSessionCookie` (**`sameSite=Strict`**, TTL 8 h), TTL absolu 8 h / idle 30 min, `STUDIO_SESSION_GLOBAL_VERSION`. **Ne lit jamais** le cookie `session` client.
- `auth/studio-oauth.ts` : `GET /studio/auth/login` (state cookie `studio_oauth_state`, path `/studio/auth/callback`), `GET /studio/auth/callback` (échange OAuth Discord `identify` ; **crée la session studio uniquement si l'utilisateur est opérateur `active` ou owner**, sinon **403**, aucune session), `POST /studio/auth/logout`. Redirect URI `https://{STUDIO_HOST}/studio/auth/callback`.
- `auth/studio-guard.ts` :
  - `requireStudioHost` : **404** si `platform.studio` off **ou** `Host != STUDIO_HOST` **ou** `STUDIO_HOST` absent.
  - `requireStudioSession` : charge la session studio ; 401 sinon ; résout l'opérateur (owner bootstrap → 13 perms ; sinon `studio_operators` actif + permissions) → `c.set('operator', …)`. Opérateur inconnu/`disabled` ⇒ **403**.
  - `requireDeveloper(permission)` : exige `requireStudioSession` + la permission ⇒ **403** sinon.
  - `studioMutationOrigin` : sur verbes d'écriture, `Origin` doit valoir `https://{STUDIO_HOST}` (allowlist stricte) ⇒ 403 sinon (double `sameSite=Strict`).

### Queries `db/queries/studio.ts`
- `getStudioOperator(db, userId)`, `listStudioOperatorPermissions(db, userId)`, `insertStudioOperator`/`grantStudioOperatorPermission` (**helpers seed/tests** — aucune API de mutation d'opérateurs en M12).
- Overview : `countGuildsForStudio`, `countActiveEntitlements`, `countOpenTicketsByPriority` (réutilise `support_tickets`), dernier update publié.
- `listGuildsForStudio(db, page, pageSize)` (lecture : id, nom, bot_installed, created_at).
- `listEntitlementsForStudio(db, page, pageSize)` (lecture : user_id, plan_id, source, status, fenêtre — **aucune PII/secret**).
- `release-notes.ts` (additif, **studio-only**) : `listReleaseNotesForStudio` (inclut brouillons), `createDraftReleaseNote`, `publishReleaseNote(slug, now)` (statut `published`, `published_at=now`).

### API `api/studio.ts` (`/studio-api/*`, host-gated, session studio)
- `GET /studio-api/session` → `StudioSessionInfo` (session studio, sans permission spécifique).
- `GET /studio-api/overview` → `StudioOverview` (session studio).
- `GET /studio-api/guilds` → `requireDeveloper('guilds.inspect')`.
- `GET /studio-api/subscriptions` → `requireDeveloper('subscriptions.read')`.
- `GET /studio-api/updates` → `requireDeveloper('updates.publish')` (inclut brouillons).
- `POST /studio-api/updates` (créer brouillon) + `POST /studio-api/updates/:slug/publish` → `requireDeveloper('updates.publish')` + `studioMutationOrigin`. Validation zod.

### Câblage `index.ts`
- Sous-app `studioRouter` montée à la racine : `requireStudioHost` sur `/studio/*` **et** `/studio-api/*`, puis `studio-oauth` + `/studio-api` (session + `requireDeveloper` par route). Body-limits studio. **Aucune** modification des routers client existants.

### Config/env
- `env.ts` : `STUDIO_HOST?`, `STUDIO_OWNER_IDS?`, `STUDIO_SESSION_GLOBAL_VERSION?`, `PLATFORM_STUDIO?`.
- `config/flags.ts` : `platform.studio` via `env.PLATFORM_STUDIO`.
- **`wrangler.jsonc` non modifié** (vars absentes ⇒ off en prod).

## 7. SPA `packages/developer-studio` (neuve, minimale)

- `package.json` (`@bot/developer-studio`, privé), réutilise React 19 / Vite 6 / Tailwind 4 / `@bot/shared` / `@bot/ui` — **aucune dépendance nouvelle**. Scripts `check` (tsc) + `build` (vite). **Non ajoutée** au `build`/`deploy` racine.
- `index.html`, `src/main.tsx`, `src/index.css` (`@import "tailwindcss"`), `src/App.tsx`.
- **`ProductionBanner`** permanent non masquable ; login gate (`GET /studio-api/session` ; 401 ⇒ bouton « Se connecter » → `/studio/auth/login`) ; navigation par onglets **gardés par permission** : Overview, Guildes (`guilds.inspect`), Abonnements (`subscriptions.read`), Updates (`updates.publish` + publication). Thème sombre dense. **Aucune** confiance aux permissions côté client : elles doublent la garde backend.

## 8. Sécurité & isolation (invariants testés)

- **Aucune route studio sur le domaine client** : `/studio-api/*` et `/studio/auth/*` ⇒ **404** si `Host != STUDIO_HOST` (et si flag off).
- **Cookie/keyspace/kill-switch distincts** : `studio_session` (`sameSite=Strict`) vs `session` (`Lax`) ; KV `studio:sess:` vs `sess:` ; `STUDIO_SESSION_GLOBAL_VERSION`. Un cookie `session` client **n'ouvre pas** le Studio.
- **Dev-auth serveur** : accès **seulement** aux opérateurs `active` (ou owner bootstrap) ; permissions vérifiées **serveur** à chaque requête, jamais depuis le client.
- **Lecture par défaut** ; publication = `updates.publish` + `studioMutationOrigin`. **Aucune** mutation d'entitlement/`paid`. Pas de suppression physique.
- **Aucune PII/secret** renvoyé par `/studio-api/*` (abonnements/guildes minimisés).

## 9. Feature flag `platform.studio` (off)

Worker `env.PLATFORM_STUDIO` ; SPA build-time `VITE_PLATFORM_STUDIO` (non requis pour l'isolation serveur). Off ⇒ tout `/studio*` **404** (rollback E4 M12 : « ne pas router `studio.archodev.fr` »). **Off en prod par défaut.**

## 10. Tests (`packages/worker/test/studio.test.ts`, D1/session réels, sans `fetchMock`)

1. **Isolation host** : `/studio-api/overview` sur host client ⇒ 404 ; sur host studio flag **off** ⇒ 404 ; flag on + host studio **sans session** ⇒ 401.
2. **Dev-auth serveur** : session studio d'un **non-opérateur** ⇒ 403 (`requireStudioSession`).
3. **Owner bootstrap** : user ∈ `STUDIO_OWNER_IDS` ⇒ overview/guildes/updates 200, publication autorisée.
4. **Permissions granulaires** : opérateur avec **seulement** `guilds.inspect` ⇒ `/guilds` 200 mais `/subscriptions` 403 et publication 403.
5. **Isolation cookie** : un cookie `session` client **ne** donne **pas** accès à `/studio-api/*` (401).
6. **Publication** : `POST /studio-api/updates/:slug/publish` ⇒ note visible via la lecture publique M5 (`GET /api/updates/:slug`) ; brouillon invisible côté public.
7. **Origin** : publication sans `Origin` studio ⇒ 403 (`studioMutationOrigin`).
8. Overview : formes KPIs (compte guildes/entitlements/tickets par priorité).

Tests auto-suffisants (rollback D1/KV entre tests — piège vitest-pool-workers). Helpers : `createStudioSession`, `insertStudioOperator`+`grantStudioOperatorPermission`.

**Validations** : `pnpm -r check` (worker + shared + ui + panel + **developer-studio**) ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** ; build `@bot/developer-studio` ; `wrangler deploy --dry-run` ; `git diff --check`.

## 11. Critères d'acceptation

1. `0037` s'applique sur base propre ; **additif**, aucun seed d'ID, aucun `DROP`.
2. **Zéro endpoint studio côté client** (404 sur host client / flag off).
3. Studio accessible **seulement** aux opérateurs `active` (ou owner bootstrap) ; **permissions vérifiées serveur**.
4. Cookie/keyspace/kill-switch studio **distincts** ; `sameSite=Strict` ; cookie client inopérant sur le Studio.
5. Abonnements = **lecture seule** (aucune mutation d'entitlement, aucun `revoke_paid`) ; publication updates fonctionnelle + gardée.
6. Flag `platform.studio` off ⇒ Studio injoignable ⇒ **aucune régression client**.
7. Aucune dépendance nouvelle/migration distante/déploiement/secret prod/suppression physique ; budget panel inchangé.
8. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 12. Rollback

- **Fonctionnel** : `platform.studio` off **ou** ne pas router `STUDIO_HOST` ⇒ Studio injoignable ; **zéro impact client** ; données conservées.
- **Code** : `git revert` du merge `master..feat/m12-studio-minimal`. Migration `0037` **additive** (tables vides) ⇒ revert la laisse inutilisée ; **aucun `DROP`**.

## 13. Stratégie de commits (Conventional + réf `M12`)

```
docs(platform): M12 execution brief                                            # poussé seul sur master AVANT la branche
feat(worker): studio operators storage, dev-auth & isolated /studio-api (M12)  # migration 0037 + shared DTO + studio-session/oauth/guard + queries + api + flag + wiring
feat(developer-studio): minimal isolated studio SPA behind platform.studio (M12)
test(platform): cover studio isolation, dev-auth & permissions (M12)
docs(platform): M12 completion report
```
Chaque commit vert ; merge **fast-forward** après validation.

## 14. Rapport final attendu

`docs/platform-split/execution/reports/M12-report.md` : modèle opérateurs/permissions, isolation (host/cookie/keyspace/kill-switch), dev-auth + matrice, API `/studio-api/*`, bootstrap secret, flag, SPA, budget, diffstat, hashes, commits, validations, confirmations (aucune mutation d'entitlement/`paid`, aucun bootstrap public, aucune route studio côté client, aucune dépendance/déploiement/migration distante/secret prod ; flag off).

---

## Micro-décisions M12 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m12.1 | Binaire studio (D22) | **Surface host-gated** dans le worker (binaire déployé séparé = différé) |
| m12.2 | Domaine (D17) | `STUDIO_HOST` var, défaut logique `studio.archodev.fr`, **absente en prod** |
| m12.3 | Bootstrap (D11) | `STUDIO_OWNER_IDS` secret ⇒ owner = opérateur implicite 13 perms ; **aucune route publique** |
| m12.4 | Session | `studio_session` `sameSite=Strict`, KV `studio:sess:`, 8 h/30 min, kill-switch dédié |
| m12.5 | Flag | **`platform.studio`** (off) ⇒ tout `/studio*` 404 |
| m12.6 | Permissions | Matrice **13** vérifiée serveur ; lecture par défaut ; publication = `updates.publish` + Origin |
| m12.7 | SPA | `packages/developer-studio` minimal, **non câblé au déploiement** |
| m12.8 | Abonnements | **Lecture seule** (grants/lifetime/révocation = M13) |
| m12.9 | Audit | **Télémétrie** (mutations loggées) ; `audit_events` immuable = M14 |
