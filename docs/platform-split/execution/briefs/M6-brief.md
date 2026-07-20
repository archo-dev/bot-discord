# Brief d'exécution — M6 · Modèle d'entitlements (derrière feature flag)

> Voir aussi : [milestones](../E4-milestones.md#m6--modèle-dentitlements-derrière-feature-flag) · [abonnements & entitlements](../../06-subscriptions-and-entitlements.md) · [modèle de données](../../08-data-model.md) · [sécurité](../../09-security-model.md) · [brief M5](./M5-brief.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m06-entitlements` après commit + push de ce brief sur `master`.

## 1. Contexte

- **Après M5** : notes de mise à jour publiques livrées (`0032`). D1 va jusqu'à `0032` → **prochaine = `0033`**. Le flag `platform.entitlements` **existe déjà** au catalogue (`packages/shared/src/flags.ts`, défaut `false`) mais **n'est encore lu nulle part**. Aucune notion de plan/abonnement côté backend : `lib/plans.ts` (panel) est **présentiel** (marketing), sans logique.
- **But de M6** : poser le **cœur métier des droits d'accès** — tables D1, **moteur de résolution du meilleur entitlement actif** (pur, déterministe), **machine d'états**, invariants de sécurité (`paid` non révocable), et une **API de lecture** `GET /api/subscription` renvoyant le **plan effectif** de l'utilisateur (**défaut Gratuit**). **Aucune UI de paiement, aucun billing, aucune mutation.** Tout est **derrière `platform.entitlements`** (défaut off ⇒ « tout Gratuit »).

## 2. Objectif utilisateur

Invisible au début (socle). Garantit que, une fois le payant activé, le **plan effectif** est calculé **côté backend** de façon déterministe (cumul, lifetime, expiration, tie-breakers), jamais depuis l'UI. Par défaut (flag off, ou aucun entitlement) : **Gratuit implicite**, sans stockage requis.

## 3. Périmètre (autorisé)

- **Migration D1 `0033_entitlements`** (additive, locale) : `plans` (+ seed free/premium/business), `entitlements`, `entitlement_guild_assignments`, `subscription_events`.
- **`@bot/shared`** : `entitlement.ts` (types, catalogue `PLANS`, `PLAN_FREE`, **`resolveEffectiveEntitlement` pur**, machine d'états `canTransition`/`isRevocable`), `api-types/subscription.ts` (DTO `SubscriptionResponse`).
- **Worker** : `config/flags.ts` (lecture du flag depuis `env`, défaut off), `db/queries/entitlements.ts` (SQL brut : lecture des entitlements d'un user, helpers d'insertion pour tests/seed, événements), `api/subscription.ts` (`GET /api/subscription`, session requise, **hors guilde**).
- **Tests** : suite **pure** exhaustive de `resolveEffectiveEntitlement` + machine d'états (shared) ; suite worker `entitlements` (résolution sur D1 réelle, flag off/on, défaut Gratuit, invariants, **aucune fuite inter-user**) — **sans `fetchMock`** (fiable).

## 4. Hors périmètre (interdit)

- ❌ **Billing / paiement / webhooks / checkout / prestataire / prix** (M9/M10/M16).
- ❌ **Origines** `billing_subscriptions` (M9), `developer_grants` (M13), `trials`/`promotions`/`partners` (campagnes/M11/M13) — `entitlements.origin_ref` reste un **FK logique** non matérialisé en M6.
- ❌ **Slots & gating effectifs** (affectation/downgrade/suspension, config gateway) = **M7** — M6 crée la table d'assignations mais **n'expose aucune mutation** ni gating.
- ❌ **UI** (l'écran abonnement client = M8) ; **Studio / grants** (M12/M13).
- ❌ Migration **distante**, déploiement, secret, dépendance, lockfile, renommage, domaine.
- ❌ Activation du flag `platform.entitlements` en **production**.

## 5. Audit des fichiers réels

| Fichier | Rôle | Décision M6 | Risque |
|---------|------|-------------|--------|
| `packages/worker/migrations/` (dernier `0032`) | Migrations additives | **Créer `0033_entitlements.sql`** (+ seed `plans`) | Faible |
| `packages/shared/src/flags.ts` | Catalogue flags (dont `platform.entitlements`) | **Réutiliser** (aucun ajout de clé) | Nul |
| `packages/shared/src/index.ts` | Barrel shared | **Ajouter** export `entitlement.js` | Nul |
| `packages/shared/src/api-types/{index}.ts` | DTOs | **Ajouter** `subscription.js` | Nul |
| `packages/worker/src/index.ts` | Monte `/api` gardé par `requireSession` | **Ajouter** `subscriptionRouter` (user-level, hors `/guilds`) | Faible |
| `packages/worker/src/db/queries.ts` | Barrel queries | **Ajouter** `entitlements.js` | Nul |
| `packages/worker/src/env.ts` | Type `Env` | **Ajouter** var optionnelle `PLATFORM_ENTITLEMENTS?` | Faible |
| `packages/panel/src/lib/plans.ts` | Catalogue présentiel | **Inchangé** (marketing) ; la vérité = backend | Nul |

## 6. Modèle de données — migration `0033` (additive)

Aligné sur [doc 08](../../08-data-model.md), **cœur uniquement** (origines créées à leurs milestones) :

### `plans` (référentiel, seedé)
`id` (`free|premium|business`, PK) · `rank` (1/2/3, UNIQUE) · `display_name` · `slots` (1/3/5) · `is_public` · `created_at` · `updated_at`.
Seed : `free`/1/1/Gratuit, `premium`/2/3/Premium, `business`/3/5/Business (identifiants stables, cf. README parent §4).

### `entitlements` (cœur)
`id` PK · `user_id` (snowflake TEXT) · `plan_id` (FK `plans`) · `source` (`paid|granted|trial|promotion|partner`) · `status` (`active|expired|revoked|cancelled|suspended|past_due`) · `start_at` · `end_at` (nullable) · `is_lifetime` (0/1) · `origin_ref` (TEXT, **FK logique** discriminé par `source`, nullable en M6) · `created_at` · `updated_at`.
- CHECK `source IN (...)`, `status IN (...)`, `is_lifetime IN (0,1)`, **`is_lifetime=0 OR end_at IS NULL`** (lifetime ⇒ pas de fin), **`is_lifetime=1 OR end_at IS NOT NULL`** (non-lifetime ⇒ fin requise).
- Index `(user_id, status)`, `(status, end_at)`, `(plan_id)`.
- **Révocabilité jamais stockée** : `revocable = source != 'paid'` (calculé). **Aucune colonne `revocable`.**

### `entitlement_guild_assignments` (créée, **write path = M7**)
`id` PK · `entitlement_id` (FK) · `guild_id` (snowflake TEXT) · `assigned_at` · `assigned_by` · `state` (`active|suspended`) · `last_reassigned_at` · `released_at`.
- Index `(entitlement_id, state)` ; **unique partiel** `(guild_id) WHERE state='active'` (un serveur actif ≤ 1 entitlement).
- M6 : **schéma seul** (aucune mutation exposée ; slots/gating = M7).

### `subscription_events` (journal append-only, **write path ultérieur**)
`id` PK · `entitlement_id` (nullable) · `billing_subscription_id` (nullable) · `type` · `from_status` · `to_status` · `actor` · `payload_json` (**secrets masqués**) · `created_at`.
- Index `(entitlement_id, created_at)`, `(type, created_at)`. Append-only (aucune route UPDATE/DELETE).

**Aucun SQL destructif.** Le seed `plans` = **configuration produit réelle** (pas de fausse donnée commerciale).

## 7. Moteur de résolution (`@bot/shared/entitlement.ts`, pur & déterministe)

```
resolveEffectiveEntitlement(entitlements, now):
  candidats = filtrer: status=='active' ET start_at<=now ET (is_lifetime OU end_at>now)
  si vide -> PLAN_FREE (implicite, aucun stockage)
  meilleur = argmax selon clé de tri:
     (rank(plan), is_lifetime?1:0, end_at ?? +inf, source_priority, created_at)
  source_priority: paid > granted > partner > promotion > trial
  retourner { planId, planRank, slots, displayName, source, status, isLifetime, endAt }
```
- **Pur** (mêmes entrées → même sortie), **aucune** dépendance D1/DOM → testable en node.
- `status='suspended'`/`expired`/`revoked`/`cancelled`/`past_due` **exclus** des candidats (seul `active` dans la fenêtre compte).
- Emplacements effectifs = `slots(meilleur.plan)` (**pas de cumul** — hypothèse doc 13 par défaut).

### Machine d'états & invariants (purs)
- `isRevocable(source)` = `source !== 'paid'` (invariant 2).
- `canTransition(from, to, source)` : refuse **`paid` → revoked** (invariant 6/garde) ; encode les transitions de [doc 06 §machine d'états].
- `assertPaidNotRevoked(...)` (garde applicative réutilisable).

## 8. Feature flag (`platform.entitlements`, **obligatoire**, défaut off)

- **Worker** : `config/flags.ts` → `getWorkerFlags(env)` applique `resolveFlags` de `@bot/shared` avec override `env.PLATFORM_ENTITLEMENTS === 'true'`. **Var non déclarée dans `wrangler.jsonc`** → absente en prod → **`false`** → « tout Gratuit ». (Pas de changement `wrangler.jsonc` ; activation future = ajout de var, hors M6.)
- **API** : `GET /api/subscription` — flag **off** ⇒ renvoie **Gratuit** sans consulter les entitlements (résolution ignorée) ; flag **on** ⇒ résout le plan effectif de l'utilisateur de session.
- **Rollback** : flag off ⇒ résolution ignorée (tout Gratuit), aucune donnée détruite.
- **Testé** : `getWorkerFlags` (off défaut / on / valeur invalide) ; service de souscription off→Gratuit, on→résolu.

## 9. API `GET /api/subscription` (lecture, session requise, hors guilde)

- Montée sous `/api` (`requireSession`), **pas** sous `/guilds/:guildId` (niveau utilisateur).
- Réponse `SubscriptionResponse` : `planId`, `planRank`, `displayName`, `slots`, `source` (`null` si Gratuit défaut), `status`, `isLifetime`, `endAt`, `entitlementsEnabled` (état du flag, pour l'awareness panel).
- **Scope strict à l'utilisateur de session** : ne lit que `entitlements.user_id = session.userId` → **aucune fuite inter-user**. Aucun champ interne d'origine (`origin_ref`, notes) exposé.
- Handler mince : délègue à un **service** `buildSubscriptionResponse(db, userId, entitlementsEnabled)` (testable sur D1 réelle, deux états de flag).

## 10. Sécurité

- **Backend = vérité** : plan effectif, révocabilité, emplacements **recalculés serveur** ; l'UI ne décide jamais.
- **`paid` non révocable** : garde `isRevocable`/`canTransition` (aucune route de révocation en M6 de toute façon).
- **Isolation user** : `/api/subscription` scopé à `session.userId` ; **aucune fuite inter-user ni inter-guilde** (pas de surface par-guilde en M6).
- **Flag obligatoire** off par défaut : aucune activation prod ; comportement identique à l'existant (tout Gratuit).
- **Invariants** ([doc 08](../../08-data-model.md#intégrité-globale--cohérence-inter-tables)) encodés/testés : révocabilité dérivée (2), lifetime⇒`end_at IS NULL` (6 partiel), `paid` jamais `revoked` (6).

## 11. Tests

**Shared (purs, node) — `entitlement.test.ts`** (exhaustif) :
- aucun entitlement → Gratuit ; un seul actif → ce plan ; **cumul** (Premium payé + Business offert → Business) ; **retour auto** au Premium à expiration du Business ; **lifetime** prioritaire à plan égal ; **tie-breakers** (end_at le plus long, puis `source_priority`, puis `created_at`) ; exclusion `expired`/`suspended`/`revoked`/`past_due`/`cancelled` ; `start_at` futur exclu ; `end_at` passé exclu ; lifetime sans `end_at` inclus.
- `isRevocable` : `paid`→false, autres→true. `canTransition` : `paid`→`revoked` **refusé**, transitions valides acceptées.

**Worker — `entitlements.test.ts`** (D1 réelle, **sans `fetchMock`**, auto-suffisant) :
- `plans` seedé (3 lignes, ranks/slots corrects) ;
- flag **off** → `/api/subscription` (ou service) = Gratuit même avec entitlements en base ;
- flag **on**, aucun entitlement → Gratuit ;
- flag **on**, un `granted premium active` → Premium ;
- cumul en base (Premium `paid` + Business `granted`) → Business, `slots=5` ;
- entitlement d'un **autre** user ignoré (isolation) ;
- entitlement `expired`/futur ignoré ;
- `GET /api/subscription` exige une **session** (401 sans cookie) ;
- `getWorkerFlags` off/on/invalide.

**Validations monorepo** : `pnpm -r check` ; suites shared/panel/gateway vertes ; worker par lots (limitation loopback connue) ; build panel + **budget ≤ 180 KiB** (panel inchangé) ; `wrangler deploy --dry-run` ; `git diff --check`.

## 12. Critères d'acceptation

1. `0033` s'applique sur base propre ; `plans` seedé ; tables + index + CHECK présents ; **additif**.
2. `resolveEffectiveEntitlement` **couvert exhaustivement** (cumul, downgrade auto, lifetime, tie-breakers, exclusions).
3. **Défaut Gratuit implicite** : aucun entitlement ou flag off ⇒ Gratuit, sans stockage.
4. `GET /api/subscription` : session requise, scopé user, renvoie le plan effectif, **aucune fuite inter-user**.
5. `platform.entitlements` **off par défaut** ⇒ tout Gratuit ⇒ **aucune régression** (comportement identique à `master`).
6. `paid` non révocable (garde testée) ; révocabilité **dérivée**, jamais stockée.
7. Aucune dépendance / migration distante / déploiement / changement Gateway/domaine/secret ; budget panel inchangé.
8. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 13. Rollback

- **Fonctionnel** : `platform.entitlements` off → résolution ignorée, tout Gratuit.
- **Code** : `git revert` de `master..feat/m06-entitlements`. Migration `0033` **additive** (tables + seed) → revert de code laisse les tables inutilisées ; **aucun `DROP`**, aucune donnée détruite.

## 14. Migrations locales

- `pnpm run migrate:local` applique `0033` en local ; suites worker via `readD1Migrations`. **Aucun** `migrate:remote`.

## 15. Stratégie de commits (Conventional + réf `M6`, ordre `CLAUDE.md`)

```
docs(platform): M6 execution brief                                     # poussé seul sur master AVANT la branche
feat(shared): entitlement model + effective-plan resolution (M6)       # DTO + moteur pur + machine d'états
feat(worker): entitlements storage, flag gating and subscription read (M6)  # migration + queries + flag + /api/subscription
test(platform): cover entitlement resolution and invariants (M6)       # shared + worker tests
docs(platform): M6 completion report
```
Chaque commit vert ; merge **fast-forward** après validation.

## 16. Rapport final attendu

`docs/platform-split/execution/reports/M6-report.md` : livré, modèle de données, moteur de résolution (clé de tri), invariants, décision de flag, API, budget, diffstat, hashes, commits, validations, confirmations (aucun billing/prix/dépendance/déploiement/migration distante ; flag off en prod ; `paid` non révocable ; aucune fuite inter-user).

---

## Micro-décisions M6 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m6.1 | Tables origines (trials/promotions/partners/billing/grants) ? | **Non en M6** — créées à leurs milestones ; `origin_ref` = FK logique |
| m6.2 | Cumul des emplacements ? | **Non** — slots du meilleur plan (hypothèse doc 13) |
| m6.3 | Source du flag Worker | **`env.PLATFORM_ENTITLEMENTS`**, non déclaré dans `wrangler.jsonc` (off par défaut) |
| m6.4 | `resolveEffectiveEntitlement` | **`@bot/shared`** (pur, testable, réutilisable panel/worker) |
| m6.5 | Assignations / événements | **Schéma seul** en M6 ; write path = M7/M9+ |
| m6.6 | `GET /api/subscription` scope | **User de session**, hors guilde |
