# Brief d'exécution — M9 · Billing sandbox

> Voir aussi : [milestones](../E4-milestones.md#m9--billing-sandbox) · [prestataires](../../07-billing-provider-analysis.md) · [abonnements](../../06-subscriptions-and-entitlements.md) · [modèle de données](../../08-data-model.md) · [E2 fiches D3](../E2-decision-fiches.md) · [brief M8](./M8-brief.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m09-billing-sandbox` après commit + push de ce brief sur `master`. **Sandbox uniquement — aucun paiement réel, aucune clé de production, aucun déploiement.**

## 1. Sélection du prestataire (sandbox) — documentée

**Choix pour l'intégration sandbox : Stripe (mode test).** Décision **technique et réversible**, distincte de la décision **commerciale** de production (D3) qui **reste ouverte**.

Justification (docs [07](../../07-billing-provider-analysis.md) & [E2 §3](../E2-decision-fiches.md)) :
1. **Compatibilité Cloudflare Workers « Excellente »** (REST + webhooks HTTP via `fetch`, signature via Web Crypto — patterns déjà maîtrisés : `/interactions` Ed25519, `/internal/*` HMAC+nonce).
2. **Mode test entièrement self-serve, sans engagement commercial/fiscal irréversible** avant le sandbox (les MoR — Lemon Squeezy/Paddle — imposent un onboarding boutique/TVA/marchand qui touche le blocage « engagements irréversibles avant le simple sandbox »).
3. **Lock-in le plus faible / migration la plus aisée** : le modèle est **découplé** (`billing_*` séparés des `entitlements`, champ `provider`) → commencer Stripe en sandbox **ne fige pas** le choix commercial (MoR reste sélectionnable en prod ; cohabitation possible).
4. **Aucune dépendance** : Checkout Session + Customer Portal = endpoints REST appelés via `fetch` ; **pas besoin du SDK Node**. (Le blocage « dépendance non prévue par le SDK officiel » n'est jamais atteint.)
5. Difficulté d'intégration la plus faible, documentation la plus large.

> **D3 (prestataire de production) reste OUVERTE** — la recommandation commerciale des docs (MoR/Lemon Squeezy pour simplicité fiscale) n'est **pas** tranchée ici. M9 ne choisit qu'une **cible d'intégration sandbox**.

## 2. Contexte & but

- **Après M6/M7/M8** : entitlements (`platform.entitlements`), slots, espace client `/app/subscription`+`/app/account`. `plans` seedé. Flag **`platform.billing`** déjà au catalogue (off).
- **But de M9** : brancher **Stripe en sandbox** avec un **checkout hosted** (PCI minimal — aucune donnée carte via le Worker), un **lien portail client hosted**, un **adaptateur découplé** (`provider`), et le **modèle de données billing** (`billing_customers`, `billing_subscriptions`). **Aucun entitlement `paid` créé ici** : la source de vérité `paid` = **webhook signé (M10)**. Tout derrière **`platform.billing`** (off en prod).

## 3. Périmètre (autorisé)

- **Migration `0034_billing`** (additive) : `billing_customers`, `billing_subscriptions`.
- **`@bot/shared`** : `api-types/billing.ts` (DTOs `BillingResponse`/`CheckoutSessionResponse`, types `BillingProvider|BillingInterval|BillingSubscriptionStatus`) + **`mapProviderStatusToEntitlementStatus`** (pur).
- **Worker** : `db/queries/billing.ts` ; **adaptateur découplé** `billing/provider.ts` (interface) + `billing/stripe.ts` (impl `fetch`, **build/parse purs**) + `billing/index.ts` (`getBillingAdapter(env)` → `null` si non configuré) ; `config/flags.ts` (+`platform.billing`) ; `api/billing.ts` (`GET /api/billing`, `POST /api/billing/checkout`, `POST /api/billing/portal`) ; `env.ts` (types optionnels : `STRIPE_SECRET_KEY?`, `STRIPE_WEBHOOK_SECRET?`, `PLATFORM_BILLING?`, `BILLING_PROVIDER?`, `BILLING_SUCCESS_URL?`, `BILLING_CANCEL_URL?`).
- **Panel** : `VITE_PLATFORM_BILLING` (flag) ; page `pages/app/Billing.tsx` (+ nav `AppLayout`) — « Passer à Premium/Business » (→ checkout), lien portail. Derrière le flag.
- **Tests** : mapping pur, queries billing (D1), **build/parse Stripe purs**, `GET /api/billing` (session, scope user, états de flag), checkout **service** avec adaptateur **factice** (⇒ url renvoyée, **aucun entitlement créé**), flag off/unavailable.

## 4. Hors périmètre (interdit)

- ❌ **Webhook `/webhooks/stripe`** et **création d'entitlement `paid`** = **M10**. M9 ne crée **jamais** de `paid`.
- ❌ **Paiement réel, clé de production, secret réel, déploiement, migration distante.** Les clés Stripe **test** sont fournies par l'exploitant hors dépôt (`.dev.vars`/`wrangler secret bulk`) ; **le dépôt n'en contient aucune** et l'adaptateur est **indisponible par défaut**.
- ❌ **Dépendance** (Stripe via `fetch`, pas de SDK) ; changement Gateway/domaine ; prix définitifs ; activation du flag en prod ; Studio (`/subscriptions/paid` = M12+).
- ❌ Migration destructive.

## 5. Modèle de données — migration `0034` (additive, [doc 08](../../08-data-model.md))

### `billing_customers`
`id` PK · `user_id` (snowflake) · `provider` (CHECK `stripe|lemonsqueezy|paddle`) · `provider_customer_id` · `email` (nullable, **PII → restreint**) · `created_at`. **Unique** (`provider`,`provider_customer_id`) ; index (`user_id`).

### `billing_subscriptions`
`id` PK · `customer_id` (FK) · `provider` · `provider_subscription_id` · `plan_id` (FK `plans`) · `status` (CHECK `active|past_due|cancelled|expired`) · `interval` (CHECK `month|year`) · `current_period_end` (nullable) · `cancel_at_period_end` (0/1) · `entitlement_id` (FK `entitlements`, **nullable** — lié par le webhook M10) · `created_at` · `updated_at`. **Unique** (`provider`,`provider_subscription_id`) ; index (`entitlement_id`), (`status`), (`current_period_end`). **Aucun SQL destructif.**

> **Règle d'intégrité (appliquée M10)** : un `billing_subscriptions` actif ⇒ un `entitlements.source='paid'`. En M9 aucune ligne n'est écrite par un flux public (tables prêtes + helpers pour tests/M10).

## 6. Adaptateur découplé (anti-lock-in)

- **`billing/provider.ts`** : `interface BillingAdapter { provider; createCheckoutSession(params): Promise<{url}>; createPortalSession(params): Promise<{url}>; }`.
- **`billing/stripe.ts`** : `buildCheckoutSessionRequest(params, secret)` / `buildPortalRequest(params, secret)` **purs** (endpoint, `Authorization: Bearer`, corps `x-www-form-urlencoded`) + `parseSessionResponse(json)` pur ; `createStripeAdapter(env)` branche l'envoi `fetch`. **Hosted** : `mode=subscription`, `success_url`/`cancel_url`, `line_items` (price mappé par plan+interval via env, **placeholders** hors prod).
- **`billing/index.ts`** : `getBillingAdapter(env)` → `stripe` si `BILLING_PROVIDER='stripe'` **et** `STRIPE_SECRET_KEY` présent, sinon **`null`** (indisponible).
- **`mapProviderStatusToEntitlementStatus`** (shared, pur) : `active→active`, `past_due→past_due`, `cancelled→cancelled`, `expired→expired` (consommé par M10 ; testé ici).

## 7. API (session, user-level, flag `platform.billing`)

- **`GET /api/billing`** → `BillingResponse` : `{ enabled, provider|null, customer|null, subscription|null, portalAvailable }` (scopé `session.userId`, **sans secret ni email d'autrui**). Flag off ⇒ `enabled:false`, tout `null`.
- **`POST /api/billing/checkout`** `{ planId: 'premium'|'business', interval: 'month'|'year' }` → `{ url }` (hosted). Flag off ⇒ **404 `feature_disabled`** ; adaptateur `null` ⇒ **503 `billing_unavailable`** ; `planId='free'`/corps invalide ⇒ 400. **Ne crée aucun entitlement.**
- **`POST /api/billing/portal`** → `{ url }` (portail hosted du client). Mêmes gardes ; 404 `no_customer` si l'utilisateur n'a pas de client billing.
- Service `createCheckout(adapter, params)` / `createPortal(adapter, customer)` **injecte l'adaptateur** ⇒ testable avec un adaptateur factice (aucun réseau).

## 8. Panel `/app/billing`

- `VITE_PLATFORM_BILLING` (défaut off) ⇒ `platform.billing` panel. Page `pages/app/Billing.tsx` (lazy) sous `AppLayout` : cartes « Passer à Premium/Business » (POST checkout → `window.location = url`), lien « Gérer mon paiement » (POST portal → redirection), état si billing indisponible. Nav `AppLayout` (Facturation) conditionnelle au flag. **Aucun prix en dur** (« sandbox »). Budget initial inchangé (page lazy).

## 9. Sécurité

- **Checkout & portail hosted** ⇒ **aucune donnée carte** via le Worker (PCI minimal).
- **Jamais de `paid` sans webhook** (M10) : M9 ne crée aucun entitlement ; le checkout ne fait que produire une URL.
- **Multitenant / isolation** : `/api/billing*` scopé `session.userId` ; jamais l'email/abonnement d'un autre user ; **aucune** surface par-guilde.
- **Secrets** : lus depuis `env` (jamais dans le dépôt) ; `STRIPE_SECRET_KEY` **test** fourni par l'exploitant via `wrangler secret bulk` (piège CRLF connu) ; **jamais** `Write-Output | wrangler secret put`. Aucune clé prod.
- **Flag off par défaut** ⇒ billing dark ⇒ aucune régression.

## 10. Tests

- **Shared (pur)** : `mapProviderStatusToEntitlementStatus` (4 statuts) ; types.
- **Worker — `billing.test.ts`** (D1/session, **sans `fetchMock`**) : migration `0034` propre ; `GET /api/billing` exige session ; flag off ⇒ `enabled:false` ; avec client+abonnement seedés (helpers) ⇒ reflète le plan, **sans email d'autrui / secret** ; **isolation** inter-user ; `POST /checkout` flag off ⇒ 404, adaptateur null ⇒ 503, corps invalide/`free` ⇒ 400 ; `createCheckout(fakeAdapter)` ⇒ `{url}` **et aucun entitlement créé** ; **build/parse Stripe purs** (endpoint `…/v1/checkout/sessions`, `Authorization: Bearer sk_test_…`, `mode=subscription`, parse `url`).
- **Panel (purs)** : `getPlatformFlags` + `VITE_PLATFORM_BILLING` ; helpers billing éventuels ; non-régression `flags-panel`.
- **Validations** : `pnpm -r check` ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** ; `wrangler deploy --dry-run` ; `git diff --check`.

## 11. Critères d'acceptation

1. `0034_billing` s'applique sur base propre (tables + contraintes + index) ; **additif**.
2. Adaptateur **découplé** (`provider`) ; Stripe via `fetch` (**aucune dépendance**) ; `getBillingAdapter` → `null` si non configuré.
3. `GET /api/billing` : session, scope user, **aucun secret/email d'autrui** ; flag off ⇒ inerte.
4. `POST /checkout` : hosted URL via adaptateur ; **aucun entitlement `paid` créé** (webhook M10) ; gardes flag/validation.
5. `mapProviderStatusToEntitlementStatus` couvert.
6. **Aucun paiement réel, aucune clé prod, aucune dépendance, aucune migration distante, aucun déploiement** ; flag `platform.billing` off ; budget inchangé (page lazy).
7. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 12. Rollback

- **Fonctionnel** : `platform.billing` off → checkout coupé ; entitlements existants **persistent** (M9 n'en crée pas).
- **Code** : `git revert` de `master..feat/m09-billing-sandbox`. Migration `0034` **additive** (tables vides) → revert de code laisse les tables inutilisées ; **aucun `DROP`**.

## 13. Migrations locales

- `pnpm run migrate:local` applique `0034` en local ; suites worker via `readD1Migrations`. **Aucun** `migrate:remote`.

## 14. Stratégie de commits (Conventional + réf `M9`)

```
docs(platform): M9 execution brief                                          # poussé seul sur master AVANT la branche
feat(worker): billing storage + decoupled Stripe sandbox adapter (M9)       # migration + shared DTO + queries + adapter + flag + /api/billing
feat(panel): client billing page behind flag (M9)
test(platform): cover billing mapping, adapter and read API (M9)
docs(platform): M9 completion report
```
Chaque commit vert ; merge **fast-forward** après validation.

## 15. Rapport final attendu

`docs/platform-split/execution/reports/M9-report.md` : sélection prestataire (sandbox = Stripe, D3 prod ouverte), modèle billing, adaptateur découplé, API, flag, budget, diffstat, hashes, commits, validations, confirmations (aucun paiement réel/clé prod/dépendance/déploiement/migration distante/`paid` créé ; flag off ; isolation).

---

## Micro-décisions M9 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m9.1 | Prestataire sandbox (D3 tech) | **Stripe (test)** — Workers-first, self-serve, réversible ; D3 **prod ouverte** |
| m9.2 | Dépendance / SDK | **Aucune** — REST via `fetch`, Web Crypto |
| m9.3 | Création `paid` | **Non** — webhook M10 (source de vérité) |
| m9.4 | Adaptateur | **Découplé** (`provider`), Stripe branché, `null` si non configuré |
| m9.5 | Secrets | **Hors dépôt** (env test fourni par l'exploitant) ; adaptateur indisponible par défaut |
| m9.6 | Flag | **`platform.billing`** (`env.PLATFORM_BILLING` / `VITE_PLATFORM_BILLING`), off |
| m9.7 | Prix | **Aucun en dur** (mapping price via env, placeholders) |
