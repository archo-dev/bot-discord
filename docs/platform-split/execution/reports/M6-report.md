# Rapport de fin de milestone — M6 · Modèle d'entitlements (derrière feature flag)

> Brief : [../briefs/M6-brief.md](../briefs/M6-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m6--modèle-dentitlements-derrière-feature-flag) · Métier : [../../06-subscriptions-and-entitlements.md](../../06-subscriptions-and-entitlements.md) · Données : [../../08-data-model.md](../../08-data-model.md)

## Résumé

M6 est **terminé et vert**. Le **cœur métier des droits d'accès** est posé : tables D1 (`0033`, additive, `plans` seedé), **moteur de résolution du meilleur entitlement actif** pur et déterministe (`@bot/shared`), **machine d'états** + invariants de sécurité (`paid` non révocable, révocabilité **dérivée** jamais stockée), et une **API de lecture** `GET /api/subscription` renvoyant le **plan effectif** de l'utilisateur de session (**défaut Gratuit**), le tout **derrière `platform.entitlements`** (défaut **off** ⇒ « tout Gratuit »). **Aucune UI de paiement, aucun billing, aucune mutation, aucune origine matérialisée.** Panel inchangé (budget stable) ; aucune migration distante, aucun déploiement.

- **Branche** : `feat/m06-entitlements`
- **HEAD initial** (master) : `d4f001c` (brief M6)
- **HEAD final** : `453c68c`

## Livré

### Migration `0033_entitlements.sql` (additive)
- **`plans`** (référentiel, **seedé**) : `free`/rang 1/1 slot/Gratuit · `premium`/2/3/Premium · `business`/3/5/Business. Identifiants stables (README §4). `rank` UNIQUE.
- **`entitlements`** (cœur) : `user_id, plan_id (FK), source, status, start_at, end_at, is_lifetime, origin_ref, timestamps`. CHECK `source`/`status`/`is_lifetime` ; **CHECK lifetime XOR end_at** (`(is_lifetime=1 AND end_at IS NULL) OR (is_lifetime=0 AND end_at IS NOT NULL)`). Index `(user_id,status)`, `(status,end_at)`, `(plan_id)`. **Aucune colonne `revocable`.**
- **`entitlement_guild_assignments`** (schéma seul, write path = M7) : unique partiel `(guild_id) WHERE state='active'`.
- **`subscription_events`** (journal append-only, write path ultérieur).
- `origin_ref` = **FK logique** discriminé par `source` (non matérialisé en M6). Aucun SQL destructif.

### `@bot/shared` — moteur pur
- **`entitlement.ts`** : `PlanId`, `PLANS`, `PLAN_FREE`, `EntitlementSource`, `EntitlementStatus`, `EntitlementInput`, `EffectiveEntitlement`, `EFFECTIVE_FREE`.
  - **`resolveEffectiveEntitlement(entitlements, now)`** — pur/déterministe. Candidats = `status='active'` ∧ `start_at ≤ now` ∧ (`lifetime` ∨ `end_at > now`). Clé de tri : **`(rank, lifetime, end_at ?? +∞, source_priority, created_at)`** ; `source_priority` = paid > granted > partner > promotion > trial. Aucun candidat → **Gratuit implicite**.
  - **`isRevocable(source)`** = `source !== 'paid'` (invariant 2). **`canTransition(from,to,source)`** : refuse **`paid → revoked`** (invariant 6), encode la machine d'états de [doc 06](../../06-subscriptions-and-entitlements.md).
- **`api-types/subscription.ts`** : DTO `SubscriptionResponse` (plan effectif, `source=null` si Gratuit, `entitlementsEnabled`).

### Worker
- **`config/flags.ts`** : `getWorkerFlags(env)` via `resolveFlags` de `@bot/shared` ; override `env.PLATFORM_ENTITLEMENTS === 'true'`. **Non déclaré dans `wrangler.jsonc`** → absent en prod → **off** (tout Gratuit). `env.ts` : var optionnelle ajoutée.
- **`db/queries/entitlements.ts`** : `listUserEntitlements` (scopé user, borné), `rowToEntitlementInput`, `listPlans`, `insertEntitlement` (helper tests/seed, garde l'invariant lifetime/end_at). SQL brut.
- **`api/subscription.ts`** : service **`buildSubscriptionResponse(db, userId, entitlementsEnabled)`** (flag off ⇒ Gratuit sans consulter la base ; on ⇒ résolution) + route **`GET /api/subscription`** (montée sous `/api`, `requireSession`, **hors `/guilds`** → niveau utilisateur).

## Décision de flag (M6.3)
`platform.entitlements` (déjà au catalogue, **off par défaut**), lu côté Worker via `env.PLATFORM_ENTITLEMENTS`. **Aucun changement `wrangler.jsonc`** : var absente en prod ⇒ off ⇒ comportement **identique à l'existant** (tout Gratuit). Activation future = déclaration/positionnement de la var (hors M6). Rollback = flag off (résolution ignorée).

## Fichiers (13 · +773)

```
 packages/shared/src/entitlement.ts               | +181  (moteur pur + machine d'états)
 packages/shared/src/api-types/subscription.ts    | +21   (DTO)
 packages/shared/src/index.ts                     | +1
 packages/shared/src/api-types/index.ts           | +1
 packages/worker/migrations/0033_entitlements.sql | +88   (plans seedé + entitlements + assignments + events)
 packages/worker/src/config/flags.ts              | +17
 packages/worker/src/db/queries/entitlements.ts   | +111
 packages/worker/src/db/queries.ts                | +1
 packages/worker/src/api/subscription.ts          | +48
 packages/worker/src/env.ts                       | +3
 packages/worker/src/index.ts                     | +3    (montage subscriptionRouter)
 packages/panel/test/entitlement.test.ts          | +179  (16 tests purs)
 packages/worker/test/entitlements.test.ts        | +119  (11 tests D1/API)
```
**Non touchés** : Gateway, `@bot/ui`, `wrangler.jsonc`, `package.json`, lockfile, panel (code applicatif — `lib/plans.ts` reste présentiel), catalogue de flags (`platform.entitlements` déjà présent).

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 5/5 |
| Tests panel (dont `entitlement` pur) | ✅ **96 / 17 fichiers** (avant M6 : 80/16 ; +16) |
| Tests Gateway | ✅ 207 (inchangé) |
| Tests Worker — `entitlements` | ✅ **11/11** (isolé) ; `entitlements + release-notes` ✅ (sans `fetchMock`) |
| Build panel + budget | ✅ **152.5 kB / 180 kB** (inchangé — code panel non touché) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check master..HEAD` | ✅ propre |
| Migration `0033` sur base propre | ✅ (appliquée via `readD1Migrations` par la suite worker) |

> **Limitation d'environnement (baseline)** : la suite Worker **complète** en un seul run reste instable sur ce poste (refus `ConnectEx` loopback du fallback service vitest-pool-workers, **zéro échec d'assertion**). Les nouvelles suites (sans `fetchMock`) passent de façon fiable par lots ; le moteur pur est couvert côté panel (node).

## Couverture de la résolution (extrait)
Cumul (Premium payé + Business offert → Business, 5 slots) · retour auto au Premium à l'expiration du Business · lifetime prioritaire à rang égal · départages (portée `end_at`, puis `source_priority`, puis `created_at`) · exclusions (`expired`/`suspended`/`revoked`/`cancelled`/`past_due`, `start_at` futur, `end_at` passé) · lifetime sans `end_at` · **isolation inter-user** · `paid` jamais `revoked` · révocabilité dérivée.

## Commits

| Hash | Message |
|------|---------|
| `d4f001c` | `docs(platform): M6 execution brief` (poussé seul sur `master` avant la branche) |
| `55de994` | `feat(shared): entitlement model + effective-plan resolution (M6)` |
| `9822bdc` | `feat(worker): entitlements storage, flag gating and subscription read (M6)` |
| `453c68c` | `test(platform): cover entitlement resolution and invariants (M6)` |

## Sécurité (confirmations)
- **Backend = vérité** : plan effectif/révocabilité/slots recalculés serveur ; l'UI ne décide jamais.
- **`paid` non révocable** (`isRevocable`/`canTransition`, testé) ; révocabilité **dérivée**, jamais stockée.
- **Isolation user** : `/api/subscription` scopé à `session.userId` (testé) → **aucune fuite inter-user**. Aucune surface par-guilde en M6 → **aucun risque inter-guilde ni d'escalade**.
- **Flag obligatoire off par défaut** : tout Gratuit ⇒ aucune régression.
- Invariants doc 08 encodés (2, 6, lifetime/end_at) et couverts.

## Confirmations
- **Aucun déploiement** · **aucune migration distante** (`0033` locale uniquement) · **aucun billing / prix / checkout / prestataire** · **aucune UI de paiement, aucune mutation** · **aucune origine matérialisée** (billing/grants/trials/promotions/partners = milestones dédiés) · **aucune dépendance / lockfile** · **aucun changement Gateway / `@bot/ui` / `wrangler.jsonc` / domaine / secret** · **flag `platform.entitlements` off en prod** · M7 non commencé.

## Rollback
- **Fonctionnel** : `platform.entitlements` off → résolution ignorée, tout Gratuit.
- **Code** : `git revert` de `master..feat/m06-entitlements`. Migration `0033` **additive** (tables + seed) → revert de code laisse les tables inutilisées ; **aucun `DROP`**, aucune donnée détruite.
