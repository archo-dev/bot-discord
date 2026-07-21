# Brief d'exécution — M10 · Webhooks paiement idempotents

> Voir aussi : [milestones](../E4-milestones.md#m10--webhooks-paiement-idempotents) · [abonnements](../../06-subscriptions-and-entitlements.md) · [prestataires](../../07-billing-provider-analysis.md) · [données](../../08-data-model.md) · [sécurité](../../09-security-model.md) · [brief M9](./M9-brief.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m10-payment-webhooks` après commit + push de ce brief sur `master`. **Sandbox uniquement — aucune clé live, aucun paiement réel, aucun déploiement, aucune migration distante.**

## 1. Contexte

- **Après M9** : Stripe **sandbox** branché — `billing_customers`/`billing_subscriptions` (`0034`), adaptateur découplé (`billing/`), `GET /api/billing` + `POST /checkout|portal`, `mapProviderStatusToEntitlementStatus` (pur). **Aucun `paid` n'est encore créé.** Entitlements (`0033`, M6) : `resolveEffectiveEntitlement`, `isRevocable`, `canTransition`, `subscription_events` (table créée, sans helper). Pattern d'idempotence existant : `INSERT … ON CONFLICT DO NOTHING` → `changes===1` (`internal_request_nonces`, `processed_events`). HMAC Web Crypto déjà utilisé (`crypto.subtle.sign/verify`, `sha256Hex`).
- **But de M10** : `POST /webhooks/stripe` (**hors session**, **signature vérifiée**, **idempotent**) = **seule** source qui crée/actualise un entitlement `paid`. Synchronise `billing_*`, pilote le cycle de vie `active/past_due/cancelled/expired`, audite via `subscription_events`. Derrière `platform.billing` (kill-switch). **Aucun `paid` depuis `success=true`/redirect.**

## 2. Périmètre (autorisé)

- **Migration `0035_billing_webhooks`** (additive, locale) : table d'idempotence `billing_webhook_events`.
- **Worker** :
  - `billing/stripe-webhook.ts` : `verifyStripeSignature` (HMAC-SHA256 Web Crypto + tolérance timestamp), `parseStripeEvent`, `normalizeStripeSubStatus`, extracteurs purs, `signStripePayload` (helper de test).
  - `billing/webhook-handler.ts` : `handleStripeWebhook(db, env, rawBody, sigHeader, nowMs)` → `{status, body}` (vérif → flag → idempotence → traitement). `ensurePaidEntitlement` (create-or-update **idempotent**, garde `paid`≠`revoked`).
  - `billing/index.ts` : `resolvePlanFromPriceId(env, priceId)` (reverse lookup `BILLING_PRICE_*`).
  - `db/queries/billing.ts` : `getBillingCustomerByProviderId`, `upsertBillingCustomer`, `getSubscriptionByProviderId`, `upsertBillingSubscription`, `setSubscriptionEntitlement`, `recordWebhookEvent` (idempotence), `insertSubscriptionEvent` (audit).
  - `db/queries/entitlements.ts` : `getEntitlementById`, `updateEntitlementStatus`, `updateEntitlementPlan` ; `insertEntitlement` renvoie l'`id`.
  - `api/webhooks.ts` : `POST /webhooks/stripe` (monté à `/`, hors `/api`, `bodyLimit`). `env.ts` : rien de neuf (M9 a déjà `STRIPE_WEBHOOK_SECRET?`).
- **Panel** : **aucun** (E4 M10 UI = néant) → budget inchangé.
- **Tests** : signature (valide/rejeu/altéré/expiré), idempotence, cycle de vie complet, `paid`≠`revoked`, isolation, aucun `paid` hors webhook.

## 3. Hors périmètre (interdit)

- ❌ Clé **live**, paiement réel, secret committé, **déploiement**, **migration distante**, dépendance (Stripe via `fetch`/Web Crypto).
- ❌ Création/mutation de `paid` **hors** webhook signé ; confiance à un retour frontend/`success`.
- ❌ Studio / workflows opérateur (`cancel_paid`/`refund_paid`) = M12+ ; `audit_events` immuable studio = M14 (M10 audite via `subscription_events`).
- ❌ Migration destructive ; changement Gateway/domaine ; activation de flag en prod.
- ❌ Tout travail **M11**.

## 4. Modèle de données — migration `0035` (additive)

`billing_webhook_events` : `event_id TEXT PRIMARY KEY` (dedup, ex. `evt_…`), `event_type TEXT NOT NULL`, `processed_at INTEGER NOT NULL` (epoch ms). Index `(processed_at)` (purge). **Aucun SQL destructif.** Les tables `entitlements`/`billing_*`/`subscription_events` de `0033`/`0034` suffisent pour le reste.

## 5. Vérification de signature (Web Crypto)

`Stripe-Signature: t=<ts>,v1=<hex>` ⇒ message = `${t}.${rawBody}` ; attendu = HMAC-SHA256(`STRIPE_WEBHOOK_SECRET`, message). **`crypto.subtle.verify("HMAC", …)`** (temps constant). Rejet si : header absent/malformé, `|now - t| > 300 s` (anti-rejeu), ou signature invalide → **400 `invalid_signature`**, **aucune** mutation. Vérif faite sur le **corps brut** (`c.req.text()`), avant tout parsing.

## 6. Pipeline `handleStripeWebhook`

1. `secret = env.STRIPE_WEBHOOK_SECRET` absent ⇒ **503 `webhook_not_configured`** (aucune mutation).
2. **Vérif signature** (raw) ⇒ échec → **400**.
3. `parseStripeEvent` ⇒ invalide → **400**.
4. **Flag** `platform.billing` off ⇒ **200 `{ignored:true}`** (kill-switch, aucune mutation ; Stripe ne rejoue pas).
5. **Idempotence** : `recordWebhookEvent(event.id)` (`ON CONFLICT DO NOTHING`) ⇒ `changes===0` → **200 `{duplicate:true}`** (rejeu sans effet).
6. **Traitement** par type (mutations **idempotentes**) ⇒ **200 `{received:true}`**.

Types gérés (sinon 200 no-op, événement quand même dédupliqué) :
- **`checkout.session.completed`** : `client_reference_id`(=userId) + `customer`(cus) ⇒ `upsertBillingCustomer(userId, stripe, cus, email?)`. **Mappe** le client (pas d'entitlement ici : le statut/période viennent des events subscription).
- **`customer.subscription.created` / `.updated`** : `id`(sub), `customer`(cus), `status`, `current_period_end`, `cancel_at_period_end`, `items[0].price.id`. ⇒ client mappé via `cus` (sinon 200 no-op) ; `plan/interval = resolvePlanFromPriceId(price)` ; `upsertBillingSubscription(...)` ; **`ensurePaidEntitlement`** : entitlement `paid` create-or-update (statut = `mapProviderStatusToEntitlementStatus(normalizeStripeSubStatus(status))`, `plan_id`, `end_at = current_period_end`, `origin_ref = billing_subscriptions.id`) + `setSubscriptionEntitlement` (lien) ; `insertSubscriptionEvent(from→to, actor:'webhook')`.
- **`customer.subscription.deleted`** : sub `expired` + entitlement `expired` + event d'audit.

**Invariants** : `paid` **jamais `revoked`** (`ensurePaidEntitlement`/`updateEntitlementStatus` refusent `revoked`) ; un `paid` actif ⇔ un `billing_subscriptions` correspondant (invariant 1, [doc 08](../../08-data-model.md)) ; toute transition ⇒ 1 `subscription_events` (invariant 5).

## 7. Idempotence & cohérence

- Dédup par `event.id` (fast-path rejeu). **Toutes** les mutations sont des **upserts** (`ON CONFLICT` sur `(provider, provider_customer_id)`, `(provider, provider_subscription_id)`, entitlement retrouvé via `billing_subscriptions.entitlement_id`) ⇒ rejouer un event donne le **même état** (sûr même après échec partiel).
- Ordre désordonné toléré : `subscription.*` avant `checkout.session.completed` ⇒ client non mappé ⇒ 200 no-op (Stripe rejoue ; ou le mapping arrive et un `subscription.updated` ultérieur crée l'entitlement). Documenté.

## 8. Montage & sécurité

- `POST /webhooks/stripe` monté sur l'app racine **avant `/api`** (comme `publicRouter`), **hors session**, **sans** `browserMutationOrigin` (server-to-server, signature = garde). Ajouter `app.use("/webhooks/*", bodyLimit(256 KiB))`.
- **Backend & Stripe = vérité** ; aucune confiance frontend. **Isolation** : l'entitlement est rattaché au `user_id` du `billing_customers` mappé par `client_reference_id` ⇒ jamais d'entitlement pour un autre user ; aucune surface par-guilde. Secrets **hors dépôt** ; `platform.billing` off par défaut.

## 9. Tests (`billing-webhook.test.ts`, D1, sans `fetchMock`)

Env **synthétique** injecté (`STRIPE_WEBHOOK_SECRET`, `PLATFORM_BILLING="true"`, `BILLING_PRICE_*`) + `signStripePayload` pour forger une signature valide :
1. **Signature** : valide→ok ; mauvais secret→400 ; corps altéré→400 ; `t` hors tolérance→400 ; header malformé/absent→400.
2. **Flag off** → 200 ignoré, **aucune** mutation.
3. `checkout.session.completed` → `billing_customers` mappé.
4. `customer.subscription.created` (active) → subscription + **entitlement `paid` actif** (premium) lié ; `resolveEffectiveEntitlement`→premium ; `buildSubscriptionResponse`→premium.
5. **Idempotence** : même event ×2 → **un seul** entitlement ; 2ᵉ → `duplicate`.
6. `subscription.updated` (past_due) → entitlement `past_due` ; puis (active) → `active`.
7. `subscription.updated` (business) → entitlement plan `business`.
8. `subscription.deleted` → entitlement `expired` ; plan effectif → **free**.
9. **`paid`≠`revoked`** : garde vérifiée.
10. **Isolation** : entitlement créé pour le seul user mappé (autre user → aucun).
11. **Aucun `paid` hors webhook** : `POST /api/billing/checkout` (M9) ne crée aucun entitlement (réaffirmé) ; aucun endpoint `success` ne crée de `paid`.
12. **Audit** : chaque transition émet un `subscription_events`.
13. **HTTP** : `POST /webhooks/stripe` non configuré/non signé → ≥ 400.

**Validations** : `pnpm -r check` ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** (inchangé) ; `wrangler deploy --dry-run` ; `git diff --check`.

## 10. Critères d'acceptation

1. `0035` s'applique sur base propre ; **additif**.
2. Signature vérifiée (Web Crypto) ; rejeu/altération/expiration rejetés (400) sans mutation.
3. Cycle de vie `paid` piloté **uniquement** par webhooks vérifiés ; **aucun** `paid` hors webhook.
4. **Idempotence** : rejeu sans effet ; état final identique.
5. `paid` **jamais `revoked`** ; transitions auditées (`subscription_events`).
6. **Isolation** stricte (entitlement ↔ user mappé) ; aucune fuite.
7. Flag `platform.billing` off ⇒ traitement désactivé (kill-switch) ⇒ aucune régression.
8. Aucune dépendance/clé live/paiement réel/migration distante/déploiement ; budget inchangé.
9. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 11. Rollback

- **Fonctionnel** : `platform.billing` off → traitement désactivé (Stripe rejoue plus tard) ; entitlements existants **persistent**.
- **Code** : `git revert` de `master..feat/m10-payment-webhooks`. Migration `0035` **additive** (table vide) → revert de code la laisse inutilisée ; **aucun `DROP`**.

## 12. Stratégie de commits (Conventional + réf `M10`)

```
docs(platform): M10 execution brief                                        # poussé seul sur master AVANT la branche
feat(worker): signed idempotent Stripe payment webhook (M10)               # migration + verif signature + handler + queries + entitlement paid
test(platform): cover webhook signature, idempotency and paid lifecycle (M10)
docs(platform): M10 completion report
```
Chaque commit vert ; merge **fast-forward** après validation.

## 13. Rapport final attendu

`docs/platform-split/execution/reports/M10-report.md` : signature, idempotence, cycle de vie `paid`, invariants, audit, migration locale, budget, diffstat, hashes, commits, validations, confirmations (aucune clé live/paiement réel/dépendance/déploiement/migration distante ; `paid` uniquement via webhook ; `paid`≠`revoked` ; isolation).

---

## Micro-décisions M10 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m10.1 | Table d'idempotence | **Dédiée** `billing_webhook_events` (pattern `processed_events`) |
| m10.2 | Plan depuis l'event | **`resolvePlanFromPriceId`** (reverse `BILLING_PRICE_*`) — pas de modif M9 |
| m10.3 | Création `paid` | **`customer.subscription.*`** (statut/période/price présents) ; `checkout.session.completed` = mapping client |
| m10.4 | Kill-switch | **`platform.billing` off ⇒ 200 ignoré** (aucune mutation) |
| m10.5 | Audit | **`subscription_events`** (actor `webhook`) ; `audit_events` studio = M14 |
| m10.6 | `paid`≠`revoked` | garde dans `ensurePaidEntitlement`/`updateEntitlementStatus` |
| m10.7 | Panel | **aucun** (backend only) |
