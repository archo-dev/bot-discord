# Brief d'exécution — M16 · Lancement commercial (préparation, SANS go-live)

> Voir aussi : [milestones](../E4-milestones.md#m16--lancement-commercial) · [offres/commercial](../../05-plans-and-commercial-strategy.md) · [paiement](../../07-billing-provider-analysis.md) · [décisions ouvertes](../../13-open-decisions.md) (D1/D3/D12/D18/D20/D21) · [tests/release](../../12-testing-and-release-strategy.md) · [rapport M15](../reports/M15-report.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m16-launch-readiness` après commit + push de ce brief sur `master`.
>
> 🚫 **AUCUN go-live irréversible.** M16 prépare **tout** (code derrière flag, config, **brouillons juridiques**, runbooks, checklists, dossier d'autorisation) et s'arrête à l'état **`READY FOR GO-LIVE — AWAITING EXPLICIT OWNER APPROVAL`**. Interdits : `migrate:remote`, déploiement, secrets Cloudflare, DNS, **clé/prix Stripe live**, **paiement réel**, activation d'un flag plateforme en prod, publication de documents juridiques présentés comme **validés par un avocat**.

## 1. Contexte

- **Après M9/M10/M15** : billing sandbox découplé (Stripe test, `billing_customers`/`billing_subscriptions`, adaptateur `provider`), webhooks signés idempotents (**`paid` uniquement via webhook**), rollout par cohortes + observabilité (M15). Page `/pricing` (M4) **sans prix** (« Tarifs à venir », D1 ouverte) ; `/legal/:doc` = stub. Aucun montant en dur dans le code. Migrations locales jusqu'à **`0039`**. Tout off en prod.
- **But de M16** : rendre la plateforme **prête au lancement commercial** — (1) **flag global `platform.launch`** (off) qui bascule l'affichage des prix réels + le checkout « live » ; (2) **prix injectés hors code** (config/env, **jamais** de montant en dur) via `GET /api/pricing` ; (3) **brouillons juridiques** `/legal/{mentions,privacy,sales}` avec bandeau **« BROUILLON — NON VALIDÉ JURIDIQUEMENT »** ; (4) **runbook go-live, checklist, templates de configuration, dossier d'autorisation**. **Rien n'est activé en prod.**

## 2. Décisions — statut (toutes = décision propriétaire, NON tranchées ici)

| # | Décision | Statut M16 | Traitement |
|---|----------|-----------|------------|
| D1 | Prix Premium/Business | **EN ATTENTE (propriétaire)** | Aucun montant en dur ; injecté par config (`LAUNCH_PRICE_*`), défaut absent ⇒ « Tarifs à venir ». |
| D3 | Prestataire (MoR vs Stripe) | **EN ATTENTE** | Adaptateur découplé déjà en place (Stripe test) ; le dossier documente la bascule. |
| D12 | Remboursement | **EN ATTENTE** | Politique = **brouillon** CGV (`/legal/sales`), non validée. |
| D18 | Rétention | **EN ATTENTE** | Brouillon confidentialité + note runbook (cron `23 4 * * *` existant). |
| D20 | TVA | **EN ATTENTE** | Dépend de D3 ; documenté (MoR = TVA gérée / Stripe = Stripe Tax). |
| D21 | CGV / mentions | **EN ATTENTE (juridique)** | **Brouillons** clairement marqués non validés. |
| D17 | Domaines | **EN ATTENTE** | Runbook DNS (bascule additive, `*.workers.dev` reste valide). |

> Le dossier d'autorisation liste ces décisions comme **cases à cocher par le propriétaire** avant le go-live.

## 3. Périmètre autorisé

- **Flag `platform.launch`** (nouveau catalogue `@bot/shared`, **off**) : worker `env.PLATFORM_LAUNCH`, panel `VITE_PLATFORM_LAUNCH`. Off ⇒ prix masqués (« Tarifs à venir »), checkout non « live » ⇒ **aucune régression**.
- **Prix hors code** : `@bot/shared/api-types/pricing.ts` (DTO + `resolveLaunchPricing` pur, `null` si config incomplète). Worker `GET /api/pricing` (public) : renvoie les prix **uniquement** si `platform.launch` on **et** `LAUNCH_PRICE_*`/`LAUNCH_CURRENCY` configurés ; sinon `{ launch:false, plans:null }`. **Zéro montant en dur.**
- **Panel** : `PricingCards` lit `/api/pricing` (fallback « Tarifs à venir ») ; `LegalPage` rend les **brouillons** `mentions`/`privacy`/`sales` avec **bandeau non-validé** ; flag `VITE_PLATFORM_LAUNCH`.
- **Brouillons juridiques** (docs source de vérité) : `docs/platform-split/execution/launch/legal/{mentions-legales,confidentialite,cgv}.draft.md` — **NON VALIDÉS**.
- **Runbooks & checklists** : `docs/platform-split/execution/launch/{go-live-runbook,go-live-checklist,config-templates,authorization-dossier}.md`.
- **Config template** : liste **exhaustive** des vars/secrets prod requis (`LAUNCH_*`, Stripe **live placeholders**, `STUDIO_HOST`/`STUDIO_OWNER_IDS`, flags) — **jamais de vraie valeur/secret**.

## 4. Hors périmètre (interdit)

- ❌ **Go-live** : `migrate:remote`, déploiement Worker/Gateway, secrets Cloudflare, DNS, domaine custom, **clé/prix Stripe live**, **paiement réel**, activation d'un flag plateforme en prod.
- ❌ **Documents juridiques présentés comme validés** : uniquement des **brouillons** explicitement non validés.
- ❌ Nouvelle dépendance importante ; migration D1 (M16 = **config**, aucune migration) ; migration destructive ; prix en dur dans le code.
- ❌ Modifier la logique d'entitlements/webhooks (déjà livrée M6/M10) au-delà du branchement `platform.launch`.

## 5. Modèle de données

**Aucune migration** (M16 = configuration ; E4 « Changements D1 futurs : aucun »).

## 6. `@bot/shared`

- `flags.ts` : **`platform.launch`** (off).
- `api-types/pricing.ts` : `PlanPricing` (`monthly`/`yearly` en **plus petite unité** entière, ex. centimes), `LaunchPricing` (`currency`, `premium`, `business`), `PricingResponse` (`launch: boolean`, `pricing: LaunchPricing | null`). **`resolveLaunchPricing(cfg)`** pur : renvoie `null` si un montant/currency manque (jamais de valeur par défaut inventée).

## 7. Worker

- `config/flags.ts` (+`platform.launch` via `env.PLATFORM_LAUNCH`) ; `env.ts` : `PLATFORM_LAUNCH?`, `LAUNCH_CURRENCY?`, `LAUNCH_PRICE_PREMIUM_MONTH?`/`_YEAR?`, `LAUNCH_PRICE_BUSINESS_MONTH?`/`_YEAR?` (montants entiers en string ; **config, pas secret**).
- `api/pricing.ts` : `GET /api/pricing` (public, hors session, `no-store`) ⇒ `PricingResponse`. `platform.launch` off ⇒ `{ launch:false, pricing:null }`. On + config complète ⇒ prix ; config incomplète ⇒ `pricing:null` (jamais d'invention). Monté à la racine (public).
- **Aucune** activation de checkout : le checkout M9 reste gardé par `platform.billing` (off) ; `platform.launch` ne fait que **révéler les prix** et signaler la disponibilité — le go-live effectif = activation manuelle des flags (runbook), hors code.

## 8. Panel

- `components/public/pricing/PricingCards.tsx` : lit `/api/pricing` ; si `pricing` présent ⇒ affiche les montants (formatés via `Intl.NumberFormat`, la période mensuel/annuel) ; sinon **fallback inchangé** « Tarifs à venir ». **Aucun montant en dur.**
- `pages/public/PublicStubs.tsx` (`LegalPage`) : rend `mentions`/`privacy`/`sales` = **brouillons** avec **bandeau rouge « BROUILLON — NON VALIDÉ JURIDIQUEMENT — ne pas publier en l'état »**. `sales` = CGV (droit de rétractation, remboursement, données — **brouillon**).
- `lib/flags.ts` : `VITE_PLATFORM_LAUNCH` → `platform.launch`.
- Budget panel **≤ 180 KiB** (pages publiques lazy).

## 9. Documents de lancement (livrables docs)

- `launch/authorization-dossier.md` : **état `READY FOR GO-LIVE — AWAITING EXPLICIT OWNER APPROVAL`**, décisions propriétaire en attente (D1/D3/D12/D18/D20/D21/D17) en **cases à cocher**, pré-requis techniques, séquence exacte de go-live (commandes **documentées, non exécutées**), critères de succès/rollback.
- `launch/go-live-runbook.md` : séquence ordonnée (`migrate:remote` 0032→0039 → deploy worker → secrets live via `wrangler secret bulk` (piège CRLF) → config prix → activation flags **par cohorte** (M15) → smoke tests prod → général), chacune avec rollback.
- `launch/go-live-checklist.md` : checklist cochable (technique, commercial, juridique, sécurité).
- `launch/config-templates.md` : vars/secrets prod (placeholders **uniquement**).
- `launch/legal/*.draft.md` : brouillons juridiques non validés.

## 10. Sécurité & réversibilité

- `platform.launch` **off** ⇒ prix masqués, aucun signal « live », checkout M9 toujours gardé par `platform.billing` (off) ⇒ **aucune régression, aucun paiement possible**.
- `GET /api/pricing` public **sans PII**, `no-store` ; ne renvoie que des montants de config.
- Brouillons juridiques **inaccessibles en prod** (sous `platform.publicSite`, off) **et** marqués non validés.
- **Aucun** secret/clé/prix live dans le dépôt.

## 11. Tests (`pricing.test.ts` + panel)

1. `resolveLaunchPricing` pur : config complète ⇒ prix ; montant/currency manquant ⇒ `null`.
2. `GET /api/pricing` : `platform.launch` off ⇒ `{launch:false, pricing:null}` ; on + config complète ⇒ prix ; on + config incomplète ⇒ `pricing:null`.
3. Panel : `PricingCards` affiche « Tarifs à venir » sans données ; affiche les montants formatés avec données.
4. Non-régression : flag off ⇒ pricing/billing inchangés ; aucun montant en dur (grep test optionnel).

**Validations** : `pnpm -r check` ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** ; build `@bot/developer-studio` ; `wrangler deploy --dry-run` ; `git diff --check`.

## 12. Critères d'acceptation

1. **`platform.launch`** off par défaut ⇒ aucune régression ; on (hors prod) ⇒ prix issus de la config, **aucun montant en dur**.
2. `GET /api/pricing` correct (off/on/config incomplète).
3. Brouillons juridiques présents, **clairement marqués non validés**, non publiés.
4. Runbook + checklist + config template + **dossier d'autorisation** complets ; état **`READY FOR GO-LIVE — AWAITING EXPLICIT OWNER APPROVAL`**.
5. **Aucune** action prod (migrate remote/deploy/DNS/secret/live key/paiement/activation flag).
6. `pnpm -r check` + suites vertes ; budget panel inchangé ; dry-run OK ; `git diff --check` propre.

## 13. Rollback

- **Fonctionnel** : `platform.launch` off ⇒ retour à « Tarifs à venir » ; billing/support/studio restent off. Instantané.
- **Code** : `git revert` du merge `master..feat/m16-launch-readiness`. **Aucune migration** ⇒ rien côté D1.

## 14. Stratégie de commits (Conventional + réf `M16`)

```
docs(platform): M16 execution brief                                          # poussé seul sur master AVANT la branche
feat(worker): launch flag + config-driven /api/pricing (no hardcoded prices) (M16)
feat(panel): pricing display from config + legal drafts behind launch flag (M16)
docs(platform): launch runbook, checklist, config templates & legal drafts (M16)
test(platform): cover launch pricing resolution & flag gating (M16)
docs(platform): M16 completion report + go-live authorization dossier
```
Merge **fast-forward** après validation.

## 15. Rapport final attendu

`docs/platform-split/execution/reports/M16-report.md` : flag launch, pricing hors code, brouillons juridiques (non validés), runbook/checklist/config/dossier, budget, diffstat, hashes, commits, validations, **confirmation `READY FOR GO-LIVE — AWAITING EXPLICIT OWNER APPROVAL`** et liste des actions propriétaire restantes.

---

## Micro-décisions M16 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m16.1 | Prix | **hors code** (config `LAUNCH_PRICE_*`), défaut absent ⇒ « Tarifs à venir » |
| m16.2 | Flag | **`platform.launch`** (off) — révèle prix + signale disponibilité ; checkout reste sous `platform.billing` |
| m16.3 | Juridique | **brouillons** non validés (bandeau), source docs + rendu SPA |
| m16.4 | Migration | **aucune** (config) |
| m16.5 | Go-live | **non exécuté** — dossier d'autorisation en attente d'accord propriétaire |
