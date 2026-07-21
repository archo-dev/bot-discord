# Brief d'exécution — M13 · Grants manuels & lifetime

> Voir aussi : [milestones](../E4-milestones.md#m13--grants-manuels--lifetime) · [studio](../../04-developer-studio.md) · [abonnements](../../06-subscriptions-and-entitlements.md) · [données](../../08-data-model.md) · [sécurité](../../09-security-model.md) · [E2 §6 (D10/D11)](../E2-decision-fiches.md) · [E7 déc. 16/17](../E7-decision-queue.md) · [rapport M12](../reports/M12-report.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m13-grants-lifetime` après commit + push de ce brief sur `master`. **Studio uniquement — s'appuie sur le dev-auth M12. Aucun paiement, aucune clé, aucune migration distante, aucun déploiement.**

## 1. Contexte

- **Après M12** : Studio isolé host-gated (`STUDIO_HOST`), cookie `studio_session` (`sameSite=Strict`), `requireDeveloper(permission)` (matrice 13 permissions), `studioMutationOrigin`, `/studio-api/*` (session/overview/guilds/subscriptions **lecture** + updates publish). Moteur d'entitlements pur (`resolveEffectiveEntitlement`, `isRevocable`, **`canTransition` garde `paid`≠`revoked`**). `insertEntitlement` (retourne l'id, invariant lifetime⇒end_at null), `insertSubscriptionEvent` (journal append-only, `actor='operator:<id>'`). Migrations locales jusqu'à **`0037`** ; tout off en prod.
- **But de M13** : **octroi/révocation d'accès offerts** (`source='granted'`) depuis le Studio + **lifetime sécurisé**. Formulaire d'octroi (durée, raison obligatoire, note interne), `developer_grants`, révocation **qui n'affecte jamais un `paid`**, lifetime = **permission dédiée** + **saisie explicite `LIFETIME`** + audit. **Backend = vérité.**

## 2. Décisions consommées

| # | Décision | Choix M13 | Réf. |
|---|----------|-----------|------|
| D10 | Politique lifetime | **Réservé exceptionnel** ; permission `subscriptions.grant_lifetime` (distincte, jamais impliquée par `grant`) + saisie `LIFETIME` + audit. **Ré-auth OAuth (step-up complet) = M14** (D24 défaut = confirmation + saisie d'abord). | E7 déc.16, E2 §6 |
| D11 | Auto-attribution | **Interdite** : un opérateur ne peut pas s'octroyer à lui-même (`userId != operator.userId` ⇒ 403). | E7 déc.17 |
| m13.1 | Origines | M13 ne traite que **`granted`** (+ table `developer_grants`). `partner`/`promotion`/`trial` = **différés** (tables d'origine non créées ici). | doc 08 |
| m13.2 | Audit | Émet **`subscription_events`** (append-only, `actor='operator:<id>'`) + télémétrie. Le journal opérateur **immuable `audit_events`** = **M14** (invariant 5 complété en M14). | doc 08 §invariant 5 |
| m13.3 | Révocation | Garde **serveur** : `UPDATE ... WHERE source != 'paid'` **et** `canTransition(active,revoked,source)`. `paid` ⇒ 409, aucune écriture. | doc 06/08 |

## 3. Hors périmètre (interdit — M14/M15/M16)

- ❌ **`audit_events` immuable + `/audit` + step-up ré-auth OAuth + rate-limits par action + kill-switch + masquage PII avancé** = **M14**.
- ❌ **`cancel_paid` / `refund_paid` / suspension fraude** d'un payé (workflows dédiés) = ultérieur ; M13 ne touche **jamais** un `paid`.
- ❌ Tables `partners` / `promotions` / `promotion_redemptions` / `trials` = différées.
- ❌ Nouvelle dépendance ; secret ; clé live ; paiement réel ; migration distante ; déploiement ; migration destructive ; activation de flag en prod ; suppression physique d'entitlement.
- ❌ Tout travail M14/M15/M16.

## 4. Modèle de données — migration `0038_developer_grants.sql` (additive, [doc 08])

### `developer_grants`
`id` PK AUTOINCREMENT · `entitlement_id` (FK `entitlements` ON DELETE CASCADE) · `granted_by` (opérateur, **NOT NULL**) · `reason` (**NOT NULL**) · `internal_note` (nullable, **jamais exposé client**) · `duration_kind` (CHECK `7d|30d|3m|6m|1y|custom|lifetime`) · `created_at` · `revoked_by` (nullable) · `revoked_at` (nullable) · `revoke_reason` (nullable).
Index : `(entitlement_id)`, `(granted_by)`. **Aucun SQL destructif.**

Chaque octroi crée **1 `entitlements` (`source='granted'`)** + **1 `developer_grants`** ; `entitlements.origin_ref` = id du grant (invariant 7). Lifetime ⇒ `is_lifetime=1`, `end_at NULL`, `duration_kind='lifetime'` (invariant 6 : **seul `granted` peut être lifetime**).

## 5. `@bot/shared`

- `api-types/grants.ts` (exporté via `api-types/index`) :
  - `GRANT_DURATION_KINDS` (tuple) + `GrantDurationKind` ; `GRANTABLE_PLANS` (`premium|business`).
  - **`resolveGrantWindow(kind, startAtISO, customEndAtISO?)`** → `{ endAt: string|null; isLifetime: boolean }` **pur/déterministe** (7d/30d/3m/6m/1y calculés ; `custom` exige `customEndAt` ; `lifetime` ⇒ `{null,true}`).
  - DTOs : `GrantSummary`, `CreateGrantRequest`, `CreateLifetimeGrantRequest` (`confirm: 'LIFETIME'`), `RevokeGrantRequest`, `GrantsListResponse` (`Paginated`).

## 6. Worker

### Queries `db/queries/grants.ts`
- `insertGrantWithEntitlement(db, {userId, planId, source:'granted', window, grantedBy, reason, internalNote, durationKind})` : `insertEntitlement` → id ; insert `developer_grants` ; `UPDATE entitlements SET origin_ref = <grantId>`. Retourne `{entitlementId, grantId}`.
- `getGrantById`, `listGrants(page, pageSize)` (join entitlements : user_id, plan_id, status, is_lifetime).
- `revokeGrantedEntitlement(db, entitlementId, revokedBy, reason)` : `UPDATE entitlements SET status='revoked' WHERE id=? AND source != 'paid' AND status='active'` (garde dure SQL) ; si `changes=0` ⇒ retourne `null` (payé/inconnu/déjà inactif) ; sinon renseigne `developer_grants.revoked_*`. Retourne la ligne pour l'audit.

### API (dans `api/studio.ts`, mêmes middlewares host-gated + session + Origin)
- `GET /studio-api/subscriptions/granted` → `requireDeveloper('subscriptions.read')` : liste des grants.
- `POST /studio-api/subscriptions/grant` → `requireDeveloper('subscriptions.grant')` : `{userId, planId, durationKind(≠lifetime), customEndAt?, reason, internalNote?}`. **Auto-attribution interdite**. Crée grant `granted`. Émet `subscription_event` (`type='grant'`). 201.
- `POST /studio-api/subscriptions/grant-lifetime` → `requireDeveloper('subscriptions.grant_lifetime')` : `{userId, planId, reason, internalNote?, confirm}`. `confirm !== 'LIFETIME'` ⇒ **400 `confirmation_required`**. Auto-attribution interdite. Crée grant lifetime. Émet `subscription_event` (`type='grant_lifetime'`). 201.
- `POST /studio-api/subscriptions/:entitlementId/revoke` → `requireDeveloper('subscriptions.revoke_granted')` : `{reason?}`. `source='paid'` ⇒ **409 `cannot_revoke_paid`** (aucune écriture). Sinon révoque + émet `subscription_event` (`type='revoke_granted'`). 200.

Validation zod (snowflake `userId`, plan ∈ `{premium,business}`, `reason` borné non vide, `customEndAt` ISO futur si `custom`). Toutes les mutations passent `studioMutationOrigin` (déjà global sur `/studio-api/*`).

## 7. SPA `@bot/developer-studio`

- Onglet **Grants** (gardé par `subscriptions.read`) : formulaire d'octroi (userId, plan, durée, raison, note interne) ; **lifetime** = section distincte avec **saisie explicite `LIFETIME`** + confirmation renforcée (`DangerConfirm`) ; liste des grants + bouton **Révoquer** (confirmation). Permissions côté client **cosmétiques** (serveur = vérité). Budget Studio séparé (documenté), panel client **inchangé**.

## 8. Sécurité & isolation (invariants testés)

- **`paid` jamais révocable** par le workflow grants (garde SQL `source != 'paid'` + `canTransition`) ⇒ 409, aucune mutation.
- **Lifetime** impossible sans `subscriptions.grant_lifetime` **et** saisie `LIFETIME` (permission distincte, jamais impliquée par `grant`).
- **Auto-attribution interdite** (opérateur ≠ cible).
- **Raison obligatoire** ; `internal_note` **jamais** exposée client (surface Studio uniquement).
- **Révocation ≠ suppression** : statut `revoked`, entitlement conservé (pas de `DELETE`).
- Toute mutation ⇒ `subscription_events` (`actor='operator:<id>'`). Host-gating + dev-auth serveur inchangés.

## 9. Feature flag

Réutilise **`platform.studio`** (off) : tout `/studio-api/*` reste 404 hors host studio / flag off. Pas de nouveau flag.

## 10. Tests (`studio-grants.test.ts`, D1/session réels, sans `fetchMock`)

1. `resolveGrantWindow` pur (7d/30d/3m/6m/1y/custom/lifetime).
2. Grant crée un entitlement **`granted` révocable** ; plan effectif reflète l'octroi.
3. Révocation ⇒ `status='revoked'` + `developer_grants.revoked_*` renseignés.
4. **`paid` non révocable** : entitlement `paid` → revoke ⇒ **409**, reste `active`.
5. Lifetime : sans permission ⇒ 403 ; `confirm != 'LIFETIME'` ⇒ 400 ; correct ⇒ `is_lifetime=1`, `end_at NULL`.
6. **Auto-attribution** : opérateur s'octroie à lui-même ⇒ 403.
7. Permission : grant sans `subscriptions.grant` ⇒ 403.
8. `subscription_events` émis (grant + revoke, `actor='operator:<id>'`).
9. Isolation host maintenue (grant route 404 host client).

**Validations** : `pnpm -r check` ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** ; build `@bot/developer-studio` ; `wrangler deploy --dry-run` ; `git diff --check`.

## 11. Critères d'acceptation

1. `0038` s'applique sur base propre ; **additif**, aucun `DROP`.
2. Grant crée un accès offert **révocable** + `developer_grants` (raison NOT NULL) ; audité (`subscription_events`).
3. Révocation ⇒ `revoked` ; **n'affecte jamais un `paid`** (409).
4. Lifetime **impossible** sans permission + saisie `LIFETIME`.
5. Auto-attribution **interdite**.
6. `internal_note` invisible client ; aucune suppression physique.
7. Aucune dépendance/migration distante/déploiement/clé/paiement ; budget panel inchangé.
8. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 12. Rollback

- **Fonctionnel** : `platform.studio` off ⇒ Studio injoignable (grants inclus) ; données conservées.
- **Code** : `git revert` du merge `master..feat/m13-grants-lifetime`. Migration `0038` **additive** (table vide) → revert la laisse inutilisée ; **aucun `DROP`**.

## 13. Stratégie de commits (Conventional + réf `M13`)

```
docs(platform): M13 execution brief                                        # poussé seul sur master AVANT la branche
feat(worker): developer grants + lifetime, revocation guards (M13)         # migration 0038 + shared DTO + queries + api
feat(developer-studio): grants panel (grant / lifetime / revoke) (M13)
test(platform): cover grants, lifetime guards & paid non-revocability (M13)
docs(platform): M13 completion report
```
Merge **fast-forward** après validation.

## 14. Rapport final attendu

`docs/platform-split/execution/reports/M13-report.md` : modèle `developer_grants`, règles grant/revoke/lifetime, gardes (paid non révocable, lifetime, auto-attribution), audit (`subscription_events`), flag, budget, diffstat, hashes, commits, validations, confirmations.

---

## Micro-décisions M13 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m13.1 | Origines couvertes | **`granted`** seul (partner/promotion/trial différés) |
| m13.2 | Audit | `subscription_events` + télémétrie (`audit_events` immuable = M14) |
| m13.3 | Step-up lifetime | permission dédiée + saisie `LIFETIME` (ré-auth OAuth = M14, D24) |
| m13.4 | Auto-attribution | **interdite** (D11) |
| m13.5 | Révocation | garde SQL `source != 'paid'` + `canTransition` ; statut `revoked` (pas de DELETE) |
| m13.6 | Flag | réutilise `platform.studio` (off) |
