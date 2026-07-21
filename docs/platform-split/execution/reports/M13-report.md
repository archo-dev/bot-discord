# Rapport de fin de milestone — M13 · Grants manuels & lifetime

> Brief : [../briefs/M13-brief.md](../briefs/M13-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m13--grants-manuels--lifetime) · Abonnements : [../../06-subscriptions-and-entitlements.md](../../06-subscriptions-and-entitlements.md) · Données : [../../08-data-model.md](../../08-data-model.md) · Sécurité : [../../09-security-model.md](../../09-security-model.md) · E2 §6 (D10/D11) · E7 déc.16/17

## Résumé

M13 est **terminé et vert**. **Grants manuels & lifetime** livrés dans le Studio isolé M12 : un opérateur `active` avec la permission dédiée **octroie** un accès offert (`entitlements.source='granted'` + `developer_grants`), **révoque** un accès offert, ou accorde un **lifetime** sous garde-fous. **Le backend est la seule vérité** : la révocation **n'affecte jamais un `paid`** (garde SQL `source != 'paid'` + `canTransition`), le **lifetime** exige la permission **distincte** `subscriptions.grant_lifetime` **et** la **saisie explicite `LIFETIME`**, et l'**auto-attribution est interdite** (un opérateur ne peut pas s'octroyer à lui-même, D11). Toute mutation émet un **`subscription_events`** (`actor='operator:<id>'`). **Aucune suppression physique** (statut `revoked`). Onglet **Grants** dans la SPA (formulaire + lifetime + révocation). Réutilise **`platform.studio`** (off). **Aucune dépendance nouvelle, aucune migration distante, aucun secret prod, aucun paiement, aucun déploiement.** Le journal opérateur **immuable `audit_events`** est **M14**.

- **Branche** : `feat/m13-grants-lifetime`
- **HEAD initial** (master) : `016fc9c` (brief M13)
- **HEAD final** : `86081ee` (avant le commit du présent rapport)

## Livré

### Migration `0038_developer_grants.sql` (additive)
- `developer_grants` : `id` PK · `entitlement_id` (FK `entitlements` **CASCADE**) · `granted_by` (**NOT NULL**) · `reason` (**NOT NULL**) · `internal_note` (**jamais exposé client**) · `duration_kind` (CHECK `7d|30d|3m|6m|1y|custom|lifetime`) · `created_at` · `revoked_by`/`revoked_at`/`revoke_reason`. Index `(entitlement_id)`, `(granted_by)`. **Aucun seed, aucun SQL destructif.**

### `@bot/shared`
- `api-types/grants.ts` : **`resolveGrantWindow(kind, startAt, customEndAt?)`** pur/déterministe (7d/30d/3m/6m/1y calculés ; `custom` exige une fin future ; `lifetime`⇒`{null,true}`) ; `GRANT_DURATION_KINDS`, `GRANTABLE_PLANS` (`premium|business`) ; DTOs `GrantSummary`, `CreateGrantRequest`, `CreateLifetimeGrantRequest` (`confirm`), `RevokeGrantRequest`, `GrantsListResponse`.

### Worker
- `db/queries/grants.ts` : `insertGrantWithEntitlement` (crée l'entitlement `granted` via `insertEntitlement`, insère `developer_grants`, pose `origin_ref` = id du grant — invariant 7), `listGrants` (join entitlements), `getEntitlementSourceStatus`, **`revokeGrantedEntitlement`** (garde dure `WHERE source != 'paid' AND status='active'` ; renseigne le trail ; retourne `cannot_revoke_paid`/`not_found`/`not_revocable`).
- `api/studio-grants.ts` (monté sur le `studioApiRouter` M12 ⇒ hérite host-gating + session + Origin) : `GET /studio-api/subscriptions/granted` (`subscriptions.read`), `POST /studio-api/subscriptions/grant` (`subscriptions.grant`), `POST …/grant-lifetime` (`subscriptions.grant_lifetime`, `confirm='LIFETIME'`), `POST …/:entitlementId/revoke` (`subscriptions.revoke_granted`). Auto-attribution ⇒ 403 `self_grant_forbidden`. `subscription_events` (`grant`/`grant_lifetime`/`revoke_granted`, `actor='operator:<id>'`). Validation zod.

### SPA `@bot/developer-studio`
- Onglet **Grants** (gardé par `subscriptions.read`) : formulaire d'octroi (userId, plan, durée, raison), **section lifetime** distincte avec saisie explicite `LIFETIME`, liste + **révocation confirmée**. Permissions client **cosmétiques** (serveur = vérité).

## Règles (backend = vérité)
- **`paid` jamais révocable** par les grants : garde SQL `source != 'paid'` ⇒ 409 `cannot_revoke_paid`, **aucune écriture**. Cohérent avec `canTransition(active,revoked,'paid')=false`.
- **Lifetime** : permission dédiée `subscriptions.grant_lifetime` (jamais impliquée par `grant`) **+** `confirm==='LIFETIME'` (sinon 400) ⇒ `is_lifetime=1`, `end_at NULL`, `duration_kind='lifetime'` (invariant 6).
- **Auto-attribution interdite** (`userId === operator.userId` ⇒ 403).
- **Raison obligatoire** ; `internal_note` jamais exposé client ; **révocation = statut `revoked`** (aucun `DELETE`).
- Chaque mutation ⇒ `subscription_events`. Host-gating + dev-auth serveur inchangés.

## Fichiers (10 · +785 / −9)

```
 packages/worker/migrations/0038_developer_grants.sql |  +34
 packages/shared/src/api-types/grants.ts              | +101
 packages/shared/src/api-types/index.ts               |   +1
 packages/worker/src/db/queries/grants.ts             | +140
 packages/worker/src/db/queries.ts                    |   +1
 packages/worker/src/api/studio-grants.ts             | +169
 packages/worker/src/api/studio.ts                    |  +10  (import + registerGrantRoutes)
 packages/developer-studio/src/App.tsx                | +137  (onglet Grants)
 packages/developer-studio/src/api.ts                 |  +18  (grant/lifetime/revoke)
 packages/worker/test/studio-grants.test.ts           | +183  (10 tests)
```
**Non touchés** : Gateway, `packages/panel`, `wrangler.jsonc`, `package.json`, **lockfile**, migrations antérieures, `@bot/ui`.

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 6/6 |
| Tests Worker — `studio-grants` | ✅ **10/10** |
| Régression Worker (`studio`/`entitlements`/`billing`/`billing-webhook`) | ✅ **47/47** |
| Build panel + budget | ✅ **153.1 kB / 180 kB** (inchangé) |
| Build `@bot/developer-studio` | ✅ (63.9 kB gzip — budget Studio séparé) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check` (staged) | ✅ propre |
| Migration `0038` sur base propre | ✅ (appliquée par `apply-migrations` ⇒ suite grants verte) |

> **Limitation d'environnement** (identique M11/M12) : nettoyage temp miniflare `EBUSY` sous Windows + suite Worker complète instable (loopback) → suites par lots, **zéro échec d'assertion**.

## Couverture des tests (10 worker)
`resolveGrantWindow` pur (7d/30d/3m/1y/lifetime/custom) · grant crée un `granted` révocable (plan effectif) · révocation (`revoked` + trail `revoked_by`/`revoke_reason`) · **`paid` non révocable (409, inchangé)** · lifetime sans permission ⇒ 403 · lifetime sans `LIFETIME` ⇒ 400 · lifetime OK ⇒ `is_lifetime=1`/`end_at NULL` · **auto-attribution ⇒ 403** (aucun entitlement créé) · grant sans `subscriptions.grant` ⇒ 403 · `subscription_events` émis · isolation host (404 host client).

## Commits
| Hash | Message |
|------|---------|
| `016fc9c` | `docs(platform): M13 execution brief` (poussé seul sur `master` avant la branche) |
| `a89e5b2` | `feat(worker): developer grants + lifetime, revocation guards (M13)` |
| `28f2fd0` | `feat(developer-studio): grants panel (grant / lifetime / revoke) (M13)` |
| `86081ee` | `test(platform): cover grants, lifetime guards & paid non-revocability (M13)` |
| _(ce rapport)_ | `docs(platform): M13 completion report` |

## Confirmations
- **`paid` jamais révocable** par le workflow grants (garde SQL + `canTransition`) · **lifetime** impossible sans permission dédiée + saisie `LIFETIME` · **auto-attribution interdite** · **raison obligatoire** · `internal_note` invisible client · **aucune suppression physique** (statut `revoked`) · toute mutation auditée (`subscription_events`, `actor='operator:<id>'`) · **audit opérateur immuable = M14** · dev-auth serveur & isolation host/cookie inchangés · **aucune dépendance/lockfile** · **aucune migration distante** · **aucun secret prod / clé live / paiement réel** · **aucun déploiement** · **flag `platform.studio` off en prod** · M14 non commencé.

## Rollback
- **Fonctionnel** : `platform.studio` off ⇒ Studio (grants inclus) injoignable ; données conservées.
- **Code** : `git revert` du merge `master..feat/m13-grants-lifetime`. Migration `0038` **additive** (table vide) → revert la laisse inutilisée ; **aucun `DROP`**.

## Décisions consommées
- **D10** (lifetime) : réservé exceptionnel, permission dédiée + saisie `LIFETIME` + audit (ré-auth OAuth = M14).
- **D11** (auto-attribution) : interdite au lancement.
- **Débloque** : M14 (audit immuable `audit_events` + step-up ré-auth + rate-limits + kill-switch), qui retrofite les mutations M13 vers l'audit append-only.
