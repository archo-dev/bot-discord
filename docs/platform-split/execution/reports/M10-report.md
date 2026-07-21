# Rapport de fin de milestone — M10 · Webhooks paiement idempotents

> Brief : [../briefs/M10-brief.md](../briefs/M10-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m10--webhooks-paiement-idempotents) · Abonnements : [../../06-subscriptions-and-entitlements.md](../../06-subscriptions-and-entitlements.md) · Sécurité : [../../09-security-model.md](../../09-security-model.md)

## Résumé

M10 est **terminé et vert**. `POST /webhooks/stripe` (**hors session**, **signature Web Crypto vérifiée**, **idempotent**) est la **seule** voie qui crée ou actualise un entitlement `paid`. Il synchronise `billing_*` et pilote le cycle de vie `active/past_due/cancelled/expired`, **sans jamais révoquer** un `paid`, en **auditant** chaque transition dans `subscription_events`. Table d'idempotence additive `0035_billing_webhooks`. Derrière `platform.billing` (kill-switch). **Aucune clé live, aucun paiement réel, aucun secret committé, aucune dépendance, aucune migration distante, aucun déploiement, aucun `paid` depuis `success=true`/redirect.** Panel intact (UI M10 = néant) → budget inchangé.

- **Branche** : `feat/m10-payment-webhooks`
- **HEAD initial** (master) : `aa2a6e9` (brief M10)
- **HEAD final** : `efde60c`

## Livré

### Migration `0035_billing_webhooks.sql` (additive)
`billing_webhook_events` : `event_id TEXT PRIMARY KEY` (dedup, `evt_…`), `event_type`, `processed_at` (epoch ms) ; index `(processed_at)`. Même pattern que `processed_events`/`internal_request_nonces`, **billing-scoped**. Aucun SQL destructif.

### Vérification de signature (`billing/stripe-webhook.ts`)
- **`verifyStripeSignature(rawBody, header, secret, nowMs, tol=300s)`** : parse `t=,v1=`, rejette hors tolérance (anti-rejeu), vérifie HMAC-SHA256 en **temps constant** (`crypto.subtle.verify`) sur le **corps brut**. `signStripePayload` (helper interne/test). `parseStripeEvent`, `normalizeStripeSubStatus` (Stripe → statut borné). **Aucune dépendance.**

### Pipeline (`billing/webhook-handler.ts`)
`handleStripeWebhook(db, env, rawBody, sig, nowMs)` → `{status, body}` :
1. secret absent → **503** ; 2. signature invalide → **400** (aucune mutation) ; 3. payload invalide → **400** ; 4. **flag `platform.billing` off → 200 `{ignored}`** (kill-switch) ; 5. **idempotence** `recordWebhookEvent` (`ON CONFLICT DO NOTHING`) → rejeu **200 `{duplicate}`** ; 6. traitement → **200 `{received}`**.
- `checkout.session.completed` → **mappe** le client (`client_reference_id`=userId ↔ `customer`), aucun entitlement.
- `customer.subscription.created|updated` → client mappé requis ; `plan = resolvePlanFromPriceId(price)` ; upsert subscription ; **`ensurePaidEntitlement`** (create-or-update `paid`, statut = `mapProviderStatusToEntitlementStatus(normalizeStripeSubStatus)`, `end_at = current_period_end`, `start_at` ISO explicite, `origin_ref`) + lien ; `subscription_events`.
- `customer.subscription.deleted` → subscription + entitlement `expired` + audit.

### Queries (`db/queries/billing.ts`, `entitlements.ts`)
`getBillingCustomerByProviderId`, `upsertBillingCustomer`, `getSubscriptionByProviderId`, `upsertBillingSubscription` (préserve le lien entitlement), `setSubscriptionEntitlement`, `recordWebhookEvent`, `insertSubscriptionEvent` ; `getEntitlementById`, **`updatePaidEntitlement`** (garde dure `paid`≠`revoked`), `insertEntitlement` renvoie l'`id`. `resolvePlanFromPriceId` (`billing/index.ts`).

### Route (`api/webhooks.ts`)
`POST /webhooks/stripe` monté à `/` **avant `/api`**, hors session, sans `browserMutationOrigin` (garde = signature) ; `bodyLimit(256 KiB)` sur `/webhooks/*`. Lit le **corps brut** (`c.req.text()`).

## Invariants & sécurité
- **Backend & Stripe = vérité** ; **aucune** confiance frontend ; **aucun `paid` hors webhook signé** (test : checkout M9 ne crée aucun entitlement).
- **`paid` jamais `revoked`** (garde testée) ; transitions bornées `active/past_due/cancelled/expired`.
- **Idempotence** : dédup par `event.id` + **toutes** les mutations sont des upserts ⇒ rejeu = même état (sûr même après échec partiel).
- **Isolation** : entitlement rattaché au seul `user_id` mappé par `client_reference_id` (test isolation) ; aucune surface par-guilde.
- **Audit** : chaque transition ⇒ `subscription_events` (actor `webhook`, invariant 5).
- **Kill-switch** `platform.billing` off ⇒ traitement désactivé (Stripe rejoue plus tard).
- Secrets **hors dépôt** ; signature vérifiée sur corps brut ; tolérance timestamp anti-rejeu.

## Fichiers (9 · +740 / −2)

```
 packages/worker/migrations/0035_billing_webhooks.sql | +14
 packages/worker/src/billing/stripe-webhook.ts        | +107 (signature Web Crypto + parse)
 packages/worker/src/billing/webhook-handler.ts       | +233 (pipeline + cycle de vie paid)
 packages/worker/src/billing/index.ts                 | +17  (resolvePlanFromPriceId)
 packages/worker/src/db/queries/billing.ts            | +132 (upserts + idempotence + audit)
 packages/worker/src/db/queries/entitlements.ts       | +40  (updatePaidEntitlement, getById, id)
 packages/worker/src/api/webhooks.ts                  | +24  (route)
 packages/worker/src/index.ts                         | +4   (montage + bodyLimit)
 packages/worker/test/billing-webhook.test.ts         | +171 (13 tests)
```
**Non touchés** : Panel (UI M10 = néant), `@bot/shared`, `@bot/ui`, Gateway, `wrangler.jsonc`, `package.json`, **lockfile** (aucune dépendance), catalogue de flags.

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 5/5 |
| Tests panel | ✅ **111** (inchangé — aucun changement panel) |
| Tests Gateway | ✅ 207 (non touché) |
| Tests Worker — `billing-webhook` | ✅ **13/13** ; `billing`+`entitlements` ✅ (non-régression M6/M9) |
| Build panel + budget | ✅ **152.8 kB / 180 kB** (inchangé) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check master..HEAD` | ✅ propre |
| Migration `0035` sur base propre | ✅ (via `readD1Migrations`) |

> **Limitation d'environnement** : suite Worker complète instable (loopback `ConnectEx`, **zéro échec d'assertion**) → suites par lots. `billing-webhook` (D1 + Web Crypto, **sans `fetchMock`**) passe de façon fiable.

## Couverture des tests (13)
Signature (valide / mauvais secret / corps altéré / expiré / malformé / absente) · 503 non configuré · 400 signature invalide (sans mutation) · **200 ignoré flag off** (kill-switch) · **`paid`≠`revoked`** (garde) · création `paid` depuis subscription vérifiée (**pas** depuis checkout seul) · **idempotence** (rejeu = pas de doublon, `duplicate`) · transitions `active→past_due→active` · changement de plan + expiry → plan effectif `free` · **isolation** (user mappé uniquement) · client non mappé → no-op · **audit** `subscription_events` · route HTTP rejette non configuré/non signé.

## Commits
| Hash | Message |
|------|---------|
| `aa2a6e9` | `docs(platform): M10 execution brief` (poussé seul sur `master` avant la branche) |
| `24ac493` | `feat(worker): signed idempotent Stripe payment webhook (M10)` |
| `efde60c` | `test(platform): cover webhook signature, idempotency and paid lifecycle (M10)` |

## Confirmations
- **Aucune clé live** · **aucun paiement réel** · **aucun secret committé** · **aucune dépendance/lockfile** (Web Crypto + `fetch`) · **`paid` uniquement via webhook signé** (jamais `success=true`/redirect) · **`paid`≠`revoked`** · **idempotent** · **isolation** garantie · **aucune migration distante** · **aucun déploiement** · **flag `platform.billing` off en prod** · M11 non commencé.

## Rollback
- **Fonctionnel** : `platform.billing` off → traitement désactivé (Stripe rejoue) ; entitlements existants persistent.
- **Code** : `git revert` de `master..feat/m10-payment-webhooks`. Migration `0035` **additive** (table vide) → revert de code la laisse inutilisée ; **aucun `DROP`**.
