# Rapport de fin de milestone — M9 · Billing sandbox

> Brief : [../briefs/M9-brief.md](../briefs/M9-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m9--billing-sandbox) · Prestataires : [../../07-billing-provider-analysis.md](../../07-billing-provider-analysis.md) · E2 §3 : [../E2-decision-fiches.md](../E2-decision-fiches.md)

## Résumé

M9 est **terminé et vert**. Intégration **billing sandbox** : modèle de données `billing_customers`/`billing_subscriptions` (migration additive `0034`), **adaptateur découplé** (`provider`) avec une implémentation **Stripe via `fetch`** (**aucune dépendance**), API **lecture** `GET /api/billing` + création de sessions **hosted** `POST /api/billing/checkout|portal`, et le **mapping pur** statut prestataire → statut d'entitlement. Le tout **derrière `platform.billing`** (off en prod). **Aucun entitlement `paid` n'est créé** (source de vérité = webhook signé, M10) ; **aucun paiement réel, aucune clé de production, aucune dépendance, aucune migration distante, aucun déploiement.** Page `/app/billing` **lazy** ⇒ bundle initial quasi inchangé.

- **Branche** : `feat/m09-billing-sandbox`
- **HEAD initial** (master) : `637675f` (brief M9)
- **HEAD final** : `0995f8e`

## Sélection du prestataire (sandbox) — documentée

**Stripe (mode test)** pour l'intégration **sandbox** — choix **technique et réversible**, **distinct** de la décision commerciale de production **D3 qui reste ouverte**. Justification (docs 07 & E2 §3) :
1. **Compat Cloudflare Workers « Excellente »** (REST + webhooks via `fetch`, signature Web Crypto — patterns déjà maîtrisés).
2. **Mode test self-serve, sans engagement commercial/fiscal irréversible** avant sandbox (contrairement aux MoR Lemon Squeezy/Paddle → onboarding boutique/TVA).
3. **Lock-in le plus faible / migration la plus aisée** ; le **découplage** (`provider`) permet de garder D3 ouverte (MoR sélectionnable en prod).
4. **Aucune dépendance** (REST via `fetch`, pas de SDK).

> La recommandation **commerciale** des docs (MoR/Lemon Squeezy pour la simplicité fiscale) **n'est pas tranchée** : M9 ne fixe qu'une **cible d'intégration sandbox**.

## Livré

### Migration `0034_billing.sql` (additive)
- `billing_customers` : `user_id, provider (CHECK stripe|lemonsqueezy|paddle), provider_customer_id, email (PII), created_at` ; **unique** `(provider, provider_customer_id)` ; index `(user_id)`.
- `billing_subscriptions` : `customer_id (FK), provider, provider_subscription_id, plan_id (FK plans), status (CHECK), interval (CHECK), current_period_end, cancel_at_period_end, entitlement_id (FK, nullable — lié par M10), timestamps` ; **unique** `(provider, provider_subscription_id)` ; index `(entitlement_id)`,`(status)`,`(current_period_end)`. **Aucun SQL destructif.**

### `@bot/shared` — `api-types/billing.ts`
Types `BillingProvider|BillingInterval|BillingSubscriptionStatus`, DTOs `BillingResponse`/`BillingSubscriptionView`/`CheckoutSessionResponse`, et **`mapProviderStatusToEntitlementStatus`** (pur, consommé par M10).

### Worker
- **Adaptateur découplé** : `billing/provider.ts` (interface `BillingAdapter`), `billing/stripe.ts` (**`buildCheckoutSessionRequest`/`buildPortalRequest`/`parseSessionResponse` purs** + envoi `fetch` ; Checkout **subscription hosted** + Customer Portal), `billing/index.ts` (`getBillingAdapter(env)` → `null` si non configuré ; `resolvePriceId`).
- `db/queries/billing.ts` : lecture (`getBillingCustomerByUser`, `getSubscriptionByUser`) + helpers d'insertion (tests/M10).
- `config/flags.ts` : `platform.billing` via `env.PLATFORM_BILLING` (non déclaré dans `wrangler.jsonc` → off en prod). `env.ts` : types optionnels (`STRIPE_SECRET_KEY?`, `STRIPE_WEBHOOK_SECRET?`, `BILLING_*`) — **aucune valeur dans le dépôt**.
- `api/billing.ts` : `GET /api/billing` (session, scope user) ; `POST /api/billing/checkout` / `/portal` (flag off → 404 `feature_disabled` ; adaptateur `null` → 503 `billing_unavailable`) ; services `createCheckoutForUser`/`createPortalForUser` (**adaptateur injecté** → testables).

### Panel
- `VITE_PLATFORM_BILLING` → `platform.billing`. Page `pages/app/Billing.tsx` (lazy) : cartes « Passer à Premium/Business » (POST checkout → redirection hosted), toggle mensuel/annuel, lien « Gérer mon paiement » (portail), état « bientôt » si désactivé. Nav `AppLayout` (Facturation) + route `/app/billing` conditionnelles au flag. **Aucun prix en dur.**

## Sécurité (confirmations)
- **Checkout & portail hosted** ⇒ **aucune donnée carte** via le Worker (PCI minimal).
- **Aucun `paid` créé** en M9 (test : `entitlements` count = 0 après checkout) — source de vérité = webhook M10.
- **Isolation** : `/api/billing*` scopé `session.userId` ; **email/secret jamais exposés** (tests explicites : ni `hidden@example.com` ni `cus_…` dans la réponse) ; aucune surface par-guilde.
- **Secrets hors dépôt** ; adaptateur **indisponible par défaut** ; aucune clé prod.
- **Flag off par défaut** ⇒ billing dark ⇒ aucune régression.

## Fichiers (18 · +784 / −4)

```
 packages/worker/migrations/0034_billing.sql | +40
 packages/shared/src/api-types/billing.ts    | +49  (DTOs + mapping pur)
 packages/worker/src/billing/provider.ts     | +29  (interface adaptateur)
 packages/worker/src/billing/stripe.ts       | +62  (build/parse purs + fetch)
 packages/worker/src/billing/index.ts        | +23  (getBillingAdapter/resolvePriceId)
 packages/worker/src/db/queries/billing.ts   | +120
 packages/worker/src/api/billing.ts          | +129 (read + checkout/portal)
 packages/worker/src/config/flags.ts         | +1   (platform.billing)
 packages/worker/src/env.ts                  | +17  (types optionnels)
 packages/worker/src/index.ts                | +2   (montage billingRouter)
 packages/panel/src/pages/app/Billing.tsx    | +126
 packages/panel/src/layouts/AppLayout.tsx    | +12  (nav Facturation)
 packages/panel/src/App.tsx                  | +3   (route /app/billing)
 packages/panel/src/lib/flags.ts             | +2   (VITE_PLATFORM_BILLING)
 packages/worker/test/billing.test.ts        | +147 (12 tests)
 packages/panel/test/billing.test.ts         | +24  (2 tests)
```
**Non touchés** : Gateway, `@bot/ui`, `wrangler.jsonc`, `package.json`, **lockfile** (aucune dépendance), migrations antérieures, catalogue de flags.

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 5/5 |
| Tests panel | ✅ **111 / 21 fichiers** (avant M9 : 109/20 ; +2) |
| Tests Gateway | ✅ 207 (non touché) |
| Tests Worker — `billing` | ✅ **12/12** ; `account`/`entitlements` ✅ (non-régression M6/M8) |
| Build panel + budget | ✅ **152.8 kB / 180 kB** (page `/app/billing` lazy) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check master..HEAD` | ✅ propre |
| Migration `0034` sur base propre | ✅ (via `readD1Migrations`) |

> **Limitation d'environnement** : suite Worker complète instable (loopback `ConnectEx`, **zéro échec d'assertion**) → suites par lots. `billing` (D1/session + adaptateur **factice injecté**, sans `fetchMock`) passe de façon fiable ; l'envoi Stripe réel (réseau/clé test) est hors tests (build/parse **purs** couverts).

## Commits
| Hash | Message |
|------|---------|
| `637675f` | `docs(platform): M9 execution brief` (poussé seul sur `master` avant la branche) |
| `40081ff` | `feat(worker): billing storage + decoupled Stripe sandbox adapter (M9)` |
| `6bb10ac` | `feat(panel): client billing page behind flag (M9)` |
| `0995f8e` | `test(platform): cover billing mapping, adapter and read API (M9)` |

## Confirmations
- **Aucun paiement réel** · **aucune clé de production** · **aucun secret dans le dépôt** · **aucune dépendance/lockfile** (Stripe via `fetch`) · **aucun `paid` créé** (webhook M10) · **aucune migration distante** · **aucun déploiement** · **aucun changement Gateway/`wrangler.jsonc`/domaine** · **flag `platform.billing` off en prod** · webhook `/webhooks/stripe` = **M10, non commencé**.

## Rollback
- **Fonctionnel** : `platform.billing` off → checkout coupé ; entitlements existants **persistent** (M9 n'en crée pas).
- **Code** : `git revert` de `master..feat/m09-billing-sandbox`. Migration `0034` **additive** (tables vides) → revert de code laisse les tables inutilisées ; **aucun `DROP`**.
