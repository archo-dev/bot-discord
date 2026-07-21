# Rapport de fin de milestone — M12 · Studio développeur minimal isolé

> Brief : [../briefs/M12-brief.md](../briefs/M12-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m12--studio-minimal) · Studio : [../../04-developer-studio.md](../../04-developer-studio.md) · Sécurité : [../../09-security-model.md](../../09-security-model.md) · Données : [../../08-data-model.md](../../08-data-model.md) · E2 §7 (D11/D22)

## Résumé

M12 est **terminé et vert**. **Studio développeur minimal isolé** livré comme **surface host-gated** dans le worker existant (décision D22 = « entry », binaire déployé séparé **différé**) : les routes `/studio/auth/*` et `/studio-api/*` ne répondent **que** si `platform.studio` est on **et** `Host == STUDIO_HOST` — **404** sur le domaine client (ou flag off). **Dev-auth serveur** (`requireDeveloper(permission)`) sur la matrice **13 permissions** ; accès **seulement** aux opérateurs `active` (allowlist `studio_operators`) ou au **propriétaire** bootstrap via secret `STUDIO_OWNER_IDS` (aucune route publique de bootstrap). **Session studio distincte** : cookie `studio_session` (`sameSite=Strict`), keyspace KV `studio:sess:`, TTL 8 h/30 min, kill-switch `STUDIO_SESSION_GLOBAL_VERSION` — le cookie client `session` **n'ouvre jamais** le Studio. API socle **lecture** (vue d'ensemble, guildes, abonnements) + **publication** des notes de mise à jour (consomme M5). **SPA minimale** `@bot/developer-studio` (login gate + `ProductionBanner` + 4 surfaces). Derrière **`platform.studio`** (nouveau flag, off). **Aucune mutation d'entitlement/`paid`, aucun bootstrap public, aucune route studio côté client, aucune dépendance externe nouvelle, aucune migration distante, aucun secret prod, aucun déploiement.**

- **Branche** : `feat/m12-studio-minimal`
- **HEAD initial** (master) : `cccb5d3` (brief M12)
- **HEAD final** : `5d81743` (avant le commit du présent rapport)

## Livré

### Migration `0037_studio_operators.sql` (additive)
- `studio_operators` : `user_id` PK · `display_name` · `status` (CHECK `active|disabled`, défaut `active`) · `note` (interne) · timestamps.
- `studio_operator_permissions` : `user_id` (FK CASCADE) · `permission` (CHECK ∈ **13 permissions** doc 09) · `granted_at` · `granted_by` · **PK (`user_id`, `permission`)** ; index `(user_id)`.
- **Aucun seed d'ID owner** (pas de snowflake en base) ; **aucun SQL destructif**.

### `@bot/shared`
- `flags.ts` : **`platform.studio`** (catalogue, défaut off).
- `api-types/studio.ts` : `STUDIO_PERMISSIONS` (tuple des 13) + `StudioPermission` + `isStudioPermission` (garde) ; DTOs `StudioSessionInfo`, `StudioOverview`, `StudioGuildSummary`, `StudioSubscriptionSummary`, `StudioUpdateSummary` (+ réponses `Paginated`). **Aucune PII/secret** dans les DTOs.

### Worker
- `auth/studio-session.ts` : cookie `studio_session` (`sameSite=Strict`), KV **`studio:sess:<id>`**, TTL **8 h absolu / 30 min idle**, `STUDIO_SESSION_GLOBAL_VERSION`, state OAuth `studio:oauthstate:`. Ne lit **jamais** le cookie client.
- `auth/studio-oauth.ts` : `/studio/auth/login|callback|logout` — **session créée uniquement si l'utilisateur est opérateur `active` ou owner** (sinon 403, aucune session). Host-gated.
- `auth/studio-guard.ts` : `requireStudioHost` (404 hors `STUDIO_HOST`/flag off), `requireStudioSession` (401/403 + résolution opérateur), `requireDeveloper(permission)` (403), `studioMutationOrigin` (Origin `https://STUDIO_HOST` strict), `resolveOperator` (owner → 13 perms ; sinon ligne active + permissions).
- `db/queries/studio.ts` : `getStudioOperator`, `listStudioOperatorPermissions`, `insertStudioOperator`/`grantStudioOperatorPermission` (seed/tests), compteurs overview (`countGuildsForStudio`/`countActiveEntitlements`/`countOpenTicketsByPriority`), `listGuildsForStudio`, `listEntitlementsForStudio` (lecture minimisée).
- `db/queries/release-notes.ts` (+studio) : `listReleaseNotesForStudio` (brouillons inclus), `createDraftReleaseNote`, `publishReleaseNote`.
- `api/studio.ts` : `GET /studio-api/session|overview|guilds|subscriptions|updates`, `POST /studio-api/updates`(+`/:slug/publish`) — session + `requireDeveloper` par route + Origin sur mutations. Abonnements **lecture seule**.
- `config/flags.ts` (+`platform.studio` via `PLATFORM_STUDIO`) ; `env.ts` (`PLATFORM_STUDIO?`, `STUDIO_HOST?`, `STUDIO_OWNER_IDS?`, `STUDIO_SESSION_GLOBAL_VERSION?`) ; `index.ts` (montage host-gated + body-limits `/studio*`).

### SPA `@bot/developer-studio` (neuve, minimale)
- React 19 / Vite 6 / Tailwind 4, réutilise `@bot/shared` + `@bot/ui` (`badgeToneClass`) — **aucune dépendance externe nouvelle**. Login gate (`/studio-api/session` → bouton `/studio/auth/login`), **`ProductionBanner`** permanent, onglets **gardés par permission** (Overview/Guildes/Abonnements/Updates + bouton Publier). **Non câblée** au `build`/`deploy` racine.

## Règles (backend = vérité)
- **Isolation host** : `requireStudioHost` ⇒ 404 sur host client / flag off ⇒ **zéro endpoint studio côté client**.
- **Dev-auth serveur** : `requireStudioSession` refuse tout non-opérateur (403) ; `requireDeveloper(p)` vérifie chaque permission **serveur** (owner passe toujours). Les permissions du frontend sont **cosmétiques**.
- **Isolation session** : cookie/keyspace/kill-switch distincts ; un `session` client ⇒ 401 sur le Studio.
- **Mutations** : publication = `updates.publish` + `studioMutationOrigin`. **Aucune** mutation d'entitlement, **aucun** `revoke_paid` (inexistant par conception). Pas de suppression physique.
- **Bootstrap** : `STUDIO_OWNER_IDS` (secret) ⇒ owner = opérateur implicite 13 perms ; **aucune route publique**.

## Fichiers (24 · +1569 / −1)

```
 packages/worker/migrations/0037_studio_operators.sql |  +48
 packages/shared/src/flags.ts                         |  +/-  (platform.studio)
 packages/shared/src/api-types/studio.ts              | +101
 packages/shared/src/api-types/index.ts               |   +1
 packages/worker/src/auth/studio-session.ts           | +161
 packages/worker/src/auth/studio-oauth.ts             | +113
 packages/worker/src/auth/studio-guard.ts             | +119
 packages/worker/src/db/queries/studio.ts             | +151
 packages/worker/src/db/queries/release-notes.ts      |  +66
 packages/worker/src/db/queries.ts                    |   +1
 packages/worker/src/api/studio.ts                    | +177
 packages/worker/src/config/flags.ts                  |   +1
 packages/worker/src/env.ts                           |  +10
 packages/worker/src/index.ts                         |   +9
 packages/developer-studio/* (SPA, 8 fichiers)        | +397
 packages/worker/test/studio.test.ts                  | +170
 pnpm-lock.yaml                                        |  +37  (nouveau package workspace)
```
**Non touchés** : Gateway, `packages/panel`, `wrangler.jsonc`, migrations antérieures, `@bot/ui` (consommé sans modif). **Aucune dépendance externe nouvelle** (le delta lockfile = enregistrement du package workspace `@bot/developer-studio`, deps déjà présentes dans le monorepo).

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 6/6 |
| Tests Worker — `studio` | ✅ **11/11** |
| Régression Worker (`release-notes`/`support`/`entitlements`) | ✅ **32/32** |
| Build panel + budget | ✅ **153.1 kB / 180 kB** (marge 26.9 kB ; inchangé) |
| Build `@bot/developer-studio` | ✅ (standalone, 62.8 kB gzip — **hors** budget panel) |
| Worker `deploy --dry-run` | ✅ (aucune var `STUDIO_*` bindée ⇒ Studio dark en prod) |
| `git diff --check` (staged) | ✅ propre |
| Migration `0037` sur base propre | ✅ (appliquée par `apply-migrations` ⇒ suite studio verte) |

> **Limitation d'environnement** (identique M11) : nettoyage temp miniflare `EBUSY` sous Windows + suite Worker complète instable (loopback) → suites par lots, **zéro échec d'assertion**. `studio` (D1 + session, **sans `fetchMock`**) passe de façon fiable.

## Couverture des tests (11 worker)
Isolation host (404 host client · 404 flag off · 401 sans session) · dev-auth serveur (non-opérateur 403 · cookie client inopérant 401) · owner bootstrap (accès complet sans ligne DB) · permissions granulaires (accordée OK · autres 403 · `disabled` 403) · publication (brouillon invisible → publié visible via lecture publique M5 · mutation sans Origin studio → 403 `csrf_rejected`) · overview KPIs (compteurs guildes/entitlements/tickets par priorité).

## Commits
| Hash | Message |
|------|---------|
| `cccb5d3` | `docs(platform): M12 execution brief` (poussé seul sur `master` avant la branche) |
| `7dd8347` | `feat(worker): studio operators storage, dev-auth & isolated /studio-api (M12)` |
| `7352f40` | `feat(developer-studio): minimal isolated studio SPA behind platform.studio (M12)` |
| `5d81743` | `test(platform): cover studio isolation, dev-auth & permissions (M12)` |
| _(ce rapport)_ | `docs(platform): M12 completion report` |

## Confirmations
- **Aucune route studio côté client** (404 host client / flag off) · **dev-auth imposé serveur** (aucune confiance au frontend) · **cookie/keyspace/kill-switch studio distincts** (`sameSite=Strict`) · **bootstrap par secret, aucune route publique** · **abonnements en lecture seule** (grants/lifetime/révocation = M13) · **aucun `revoke_paid`** (par conception) · **aucune suppression physique** · **audit opérateur immuable = M14** (M12 logge en télémétrie) · **aucune dépendance externe nouvelle** · **aucune migration distante** · **aucun secret prod / clé live / paiement réel** · **aucun déploiement** · **flag `platform.studio` off en prod** · M13 non commencé.

## Rollback
- **Fonctionnel** : `platform.studio` off **ou** ne pas router `STUDIO_HOST` ⇒ Studio injoignable ; **zéro impact client** ; données conservées.
- **Code** : `git revert` du merge `master..feat/m12-studio-minimal`. Migration `0037` **additive** (tables vides) → revert la laisse inutilisée ; **aucun `DROP`**.

## Décisions consommées / débloquées
- **D22** (worker-studio *ou* entry) : consommée = **entry host-gated** (binaire déployé séparé différé, réversible sans déploiement).
- **D17** (domaine studio) : `STUDIO_HOST` (défaut logique `studio.archodev.fr`), non déclarée en prod.
- **D11** (bootstrap propriétaire) : `STUDIO_OWNER_IDS` (secret), aucune route publique.
- **Débloque** : M13 (grants manuels & lifetime — s'appuie sur `requireDeveloper`/`studio_operators`), M14 (audit immuable & durcissement), M15 (rollout & observabilité studio).
