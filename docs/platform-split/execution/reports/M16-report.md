# Rapport de fin de milestone — M16 · Lancement commercial (préparation, SANS go-live)

> Brief : [../briefs/M16-brief.md](../briefs/M16-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m16--lancement-commercial) · Décisions : [../../13-open-decisions.md](../../13-open-decisions.md) · Dossier d'autorisation : [../launch/authorization-dossier.md](../launch/authorization-dossier.md) · [rapport M15](./M15-report.md)

## ÉTAT

```
READY FOR GO-LIVE — AWAITING EXPLICIT OWNER APPROVAL
```

Tout le code, la configuration (par placeholders), les brouillons juridiques et les runbooks sont **prêts et réversibles**. **Aucune action de production n'a été exécutée.** Le go-live attend les décisions propriétaire (D1/D3/D12/D18/D20/D21/D17), la **validation juridique** des brouillons et une **autorisation explicite**.

## Résumé

M16 est **terminé et vert**. **Préparation complète du lancement commercial sans go-live** : (1) **flag `platform.launch`** (off) qui révèle les prix + le signal de disponibilité, sans toucher au checkout (toujours gardé par `platform.billing`, off) ⇒ **aucune régression** ; (2) **prix hors code** — `GET /api/pricing` public renvoie des montants **uniquement** issus de la config (`LAUNCH_*`) quand `platform.launch` est on **et** la config complète ; sinon `pricing:null` ⇒ « Tarifs à venir » (résolveur pur `resolveLaunchPricing`, **aucun montant inventé**) ; (3) **brouillons juridiques** `/legal/{mentions,privacy,sales}` avec bandeau **« BROUILLON — NON VALIDÉ JURIDIQUEMENT »** (sous `platform.publicSite`, off) ; (4) **dossier d'autorisation + runbook + checklist + templates de config + brouillons juridiques** (docs). **Aucune migration, aucune dépendance, aucune clé/prix live, aucun paiement, aucun déploiement, aucune activation de flag en prod.**

- **Branche** : `feat/m16-launch-readiness`
- **HEAD initial** (master) : `6529da4` (brief M16)
- **HEAD final** : `8c2be6a` (avant le commit du présent rapport)

## Livré

### `@bot/shared`
- `flags.ts` : **`platform.launch`** (off).
- `api-types/pricing.ts` : `PlanPricing`/`LaunchPricing`/`PricingResponse`/`LaunchPricingConfig` ; **`resolveLaunchPricing`** pur (montants **entiers** en plus petite unité ; `null` si currency/montant manquant ou non entier — **jamais** de défaut inventé).

### Worker
- `env.ts` : `PLATFORM_LAUNCH?`, `LAUNCH_CURRENCY?`, `LAUNCH_PRICE_PREMIUM_MONTH/_YEAR?`, `LAUNCH_PRICE_BUSINESS_MONTH/_YEAR?` (config, pas secret).
- `config/flags.ts` : `platform.launch` via `PLATFORM_LAUNCH`.
- `api/pricing.ts` : **`GET /api/pricing`** public (`no-store`, sans PII) ⇒ prix si `launch` on + config complète, sinon `{launch:false, pricing:null}`. **Aucun prix en dur.** Monté à la racine.

### Panel
- `PricingCards.tsx` : lit `/api/pricing` (montants formatés `Intl.NumberFormat`, période) ; **fallback inchangé** « Tarifs à venir » si config absente/indisponible. **Aucun montant en dur.**
- `PublicStubs.tsx` (`LegalPage`) : brouillons **mentions/confidentialité/CGV(sales)/terms** avec **bandeau rouge non-validé**. Sous `platform.publicSite` (off) ⇒ non publiés.
- `lib/flags.ts` : `VITE_PLATFORM_LAUNCH` → `platform.launch`.

### Documents de lancement (`docs/platform-split/execution/launch/`)
- **`authorization-dossier.md`** : état `READY FOR GO-LIVE — AWAITING EXPLICIT OWNER APPROVAL`, décisions propriétaire en cases à cocher, pré-requis, séquence (commandes **non exécutées**), critères succès/rollback, ligne de signature.
- `go-live-runbook.md` : séquence ordonnée réversible (migrate:remote → secrets bulk → deploy → studio → rollout cohortes → smoke tests → launch), pièges `CLAUDE.md`.
- `go-live-checklist.md` : technique / commercial / juridique / sécurité / go-no-go.
- `config-templates.md` : vars/secrets prod **placeholders uniquement**.
- `legal/{mentions-legales,confidentialite,cgv}.draft.md` : brouillons **non validés**.

## Règles (backend = vérité, réversibilité)
- `platform.launch` **off** ⇒ prix masqués, aucun signal live ; checkout M9 toujours sous `platform.billing` (off) ⇒ **aucun paiement possible, aucune régression**.
- **Aucun prix en dur** : les montants ne vivent que dans `LAUNCH_*` ; `resolveLaunchPricing` renvoie `null` si incomplet.
- Brouillons juridiques **non validés** + **inaccessibles en prod** (publicSite off).
- **Aucun** secret/clé/prix live dans le dépôt.

## Fichiers (18 · +678 / −36)

```
 packages/shared/src/flags.ts                        |   +8   (platform.launch)
 packages/shared/src/api-types/pricing.ts            |  +60
 packages/shared/src/api-types/index.ts              |   +1
 packages/worker/src/env.ts                          |   +9
 packages/worker/src/config/flags.ts                 |   +1
 packages/worker/src/api/pricing.ts                  |  +28
 packages/worker/src/index.ts                        |   +3   (mount /api/pricing)
 packages/panel/src/components/public/pricing/PricingCards.tsx | +102/−36
 packages/panel/src/pages/public/PublicStubs.tsx     |  +73   (legal drafts)
 packages/panel/src/lib/flags.ts                     |   +1
 packages/worker/test/pricing.test.ts                |  +54   (4 tests)
 docs/.../launch/authorization-dossier.md            |  +74
 docs/.../launch/go-live-runbook.md                  |  +72
 docs/.../launch/go-live-checklist.md                |  +42
 docs/.../launch/config-templates.md                 |  +64
 docs/.../launch/legal/{mentions,confidentialite,cgv}.draft.md | +122
```
**Non touchés** : Gateway, `wrangler.jsonc`, `package.json`, **lockfile**, **migrations** (aucune), `@bot/ui`, logique entitlements/webhooks (M6/M10).

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 6/6 |
| Tests Worker — `pricing` | ✅ **4/4** |
| Régression Worker (`support`/`billing`/`subscription`/`studio-observability`) | ✅ **41/41** |
| Tests Gateway | ✅ **207/207** (flag ajouté au catalogue, sans impact) |
| Tests Panel | ✅ **114/114** |
| Build panel + budget | ✅ **153.2 kB / 180 kB** (marge 26.8 kB ; pricing/legal en chunks lazy) |
| Build `@bot/developer-studio` | ✅ |
| Worker `deploy --dry-run` | ✅ (aucune var `LAUNCH_*`/`PLATFORM_LAUNCH` bindée ⇒ prix dark) |
| `git diff --check` (staged) | ✅ propre |
| Migration | ✅ **aucune** (config) |

## Couverture des tests (4 worker)
`resolveLaunchPricing` pur (complet → prix ; montant manquant/currency vide/non-entier → null) · `GET /api/pricing` : off ⇒ `{launch:false, pricing:null}` ; on + config complète ⇒ prix configurés ; on + config incomplète ⇒ `pricing:null` (jamais inventé).

## Actions propriétaire restantes (avant go-live)
1. **D1** : fixer les prix Premium/Business (→ `LAUNCH_*`).
2. **D3** : choisir le prestataire (MoR/Stripe) et poser les clés **live** hors dépôt.
3. **D12/D18/D20** : valider remboursement / rétention / TVA.
4. **D21** : faire **valider juridiquement** les brouillons `legal/*.draft.md`.
5. **D17** : confirmer les domaines (DNS, OAuth, Interactions).
6. Dérouler le **runbook** (migrate:remote → deploy → rollout cohortes → smoke tests) puis `platform.launch` on.
7. **Signer** le dossier d'autorisation.

## Commits
| Hash | Message |
|------|---------|
| `6529da4` | `docs(platform): M16 execution brief` (poussé seul sur `master` avant la branche) |
| `303a854` | `feat(worker): launch flag + config-driven /api/pricing (no hardcoded prices) (M16)` |
| `4175a10` | `feat(panel): pricing display from config + legal drafts behind launch flag (M16)` |
| `13ce366` | `docs(platform): launch runbook, checklist, config templates & legal drafts (M16)` |
| `8c2be6a` | `test(platform): cover launch pricing resolution & flag gating (M16)` |
| _(ce rapport)_ | `docs(platform): M16 completion report + go-live authorization dossier` |

## Confirmations (barrière de sécurité respectée)
- **Aucune** exécution : `migrate:remote`, migration distante, déploiement Worker/Gateway, systemd, cron, secrets Cloudflare, DNS, domaine custom, **clé/prix Stripe live**, **paiement réel**, activation d'un flag plateforme en prod, publication juridique validée.
- **Aucun prix en dur** (config `LAUNCH_*`) · brouillons juridiques **non validés** · `platform.launch` off ⇒ aucune régression · checkout toujours sous `platform.billing` (off) · **aucune migration/dépendance/lockfile** · budget panel tenu · état **`READY FOR GO-LIVE — AWAITING EXPLICIT OWNER APPROVAL`**.

## Rollback
- **Fonctionnel** : `platform.launch` off ⇒ « Tarifs à venir » ; billing/support/studio restent off. Instantané.
- **Code** : `git revert` du merge `master..feat/m16-launch-readiness`. **Aucune migration** ⇒ rien côté D1.
