# Rapport de fin de milestone — M15 · Déploiement progressif & observabilité

> Brief : [../briefs/M15-brief.md](../briefs/M15-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m15--déploiement-progressif--observabilité) · Roadmap : [../../11-migration-roadmap.md](../../11-migration-roadmap.md) · Tests/release : [../../12-testing-and-release-strategy.md](../../12-testing-and-release-strategy.md) · [rapport M14](./M14-report.md)

## Résumé

M15 est **terminé et vert**. **Observabilité + déploiement progressif** pour la plateforme. (1) **Dashboards Studio** — `GET /studio-api/metrics` & `/studio-api/errors` (`deployments.read`) agrègent `operation_metrics` **cross-guilde** sur le `guild_key` **déjà pseudonymisé** (jamais de PII/ID brut). (2) **`/status` public enrichi** (Worker/Gateway/D1/KV, états `up|degraded|down`, âge heartbeat, sans détail sensible, non gated). (3) **Rollout progressif par cohortes** — store **KV** `platform:rollout:<flag>` (`global` + guildes pilotes) modifiable **sans redeploy** (`PUT /studio-api/rollout/:flag`, `features.manage` + Origin + **audit**), résolveur **pur** `resolveRollout` + résolveur worker **opt-in** `resolveGuildFlag` (les consommateurs de flags existants **ne sont pas modifiés** → aucune régression). **Consultation seule** (aucun déclenchement de déploiement, D26). **Aucune migration, aucune dépendance, aucune activation de flag en prod, aucun déploiement, aucune bascule DNS.**

- **Branche** : `feat/m15-observability-rollout`
- **HEAD initial** (master) : `ac72307` (brief M15)
- **HEAD final** : `06d97a6` (avant le commit du présent rapport)

## Livré

### `@bot/shared`
- `api-types/observability.ts` : DTOs `StudioMetricsSummary`/`StudioMetricsResponse`, `StudioErrorBucket`/`StudioErrorsResponse`, `PublicStatus`/`PublicStatusComponent`, `RolloutFlagState`/`RolloutResponse` ; **`resolveRollout`** pur (`globalOn || guilde ∈ cohorte`).

### Worker
- `db/queries/observability.ts` (+studio) : **`aggregateMetricsForStudio`** (SUM cross-guilde par module : events/samples/errors/buckets/lastObserved), **`topErrorsForStudio`** (top `(module, operation)` par `error_count`). Bornés (1..168 h), **aucun ID guilde brut**.
- `db/queries/rollout.ts` (**KV**) : `getRollout`/`setRollout`/`listRollout` (`platform:rollout:<flag>` → `{global, guilds[]}`, validation snowflakes, dédup).
- `config/rollout.ts` : **`resolveGuildFlag(env, kv, flag, guildId)`** = flag global **OU** cohorte KV — **opt-in**, aucun consommateur existant modifié.
- `api/status.ts` : **`GET /status`** public (Worker up, Gateway via heartbeat KV + âge/degraded > 180 s, D1 `SELECT 1`, KV ping), `no-store`, sans PII.
- `api/studio-observability.ts` (monté sur `studioApiRouter`) : `GET /studio-api/metrics|errors|rollout` (`deployments.read`), `PUT /studio-api/rollout/:flag` (`features.manage` + rate-limit + Origin + **`writeStudioAudit`**), `GET …/rollout/:flag/check`.

### SPA `@bot/developer-studio`
- Onglets **Métriques** & **Erreurs** (`deployments.read`), **Rollout** (édition sous `features.manage` : global + cohorte de guildes pilotes, sans redéploiement).

## Règles (backend = vérité)
- Dashboards **lecture seule** (`deployments.read`) ; édition rollout = `features.manage` + Origin + **audit** (`audit_events`).
- **Aucune PII** : agrégation sur `guild_key` pseudonymisé ; `/status` = états de composants.
- Rollout **additif/opt-in** : global off + cohortes vides ⇒ **aucun** changement de comportement (rétrocompat totale). Host-gating, dev-auth serveur inchangés.

## Fichiers (13 · +667 / −2)

```
 packages/shared/src/api-types/observability.ts    |  +75
 packages/shared/src/api-types/index.ts             |   +1
 packages/worker/src/db/queries/observability.ts    |  +72
 packages/worker/src/db/queries/rollout.ts          |  +41
 packages/worker/src/db/queries.ts                  |   +1
 packages/worker/src/config/rollout.ts              |  +22
 packages/worker/src/api/status.ts                  |  +63
 packages/worker/src/api/studio-observability.ts    | +116
 packages/worker/src/api/studio.ts                  |   +3
 packages/worker/src/index.ts                       |   +3   (mount /status)
 packages/developer-studio/src/App.tsx              | +119   (Métriques/Erreurs/Rollout)
 packages/developer-studio/src/api.ts               |  +23
 packages/worker/test/studio-observability.test.ts | +130   (7 tests)
```
**Non touchés** : Gateway, `packages/panel`, `wrangler.jsonc`, `package.json`, **lockfile**, **migrations** (aucune), `@bot/ui`.

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 6/6 |
| Tests Worker — `studio-observability` | ✅ **7/7** |
| Régression Worker (`studio`/`studio-grants`/`studio-audit`/`entitlements`) | ✅ **48/48** |
| Build panel + budget | ✅ **153.1 kB / 180 kB** (inchangé) |
| Build `@bot/developer-studio` | ✅ (64.9 kB gzip — budget Studio séparé) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check` (staged) | ✅ propre |
| Migration | ✅ **aucune** (réutilise `operation_metrics`) |

> **Limitation d'environnement** (identique M11–M14) : nettoyage temp miniflare `EBUSY` sous Windows + suite Worker complète instable (loopback) → suites par lots, **zéro échec d'assertion**.

## Couverture des tests (7 worker)
`resolveRollout` pur · agrégation métriques cross-guilde (events/errors corrects, **aucun ID guilde**) + top erreurs · `/status` public (worker/d1 up, gateway présent) · store rollout KV (`set`/`get`) + `resolveGuildFlag` **opt-in** (global off + cohorte ⇒ true) · `PUT rollout` audité + validation snowflakes (400 sur invalide) · permissions (`/metrics` sans `deployments.read` ⇒ 403 ; `PUT rollout` sans `features.manage` ⇒ 403) · isolation host (404 sur host client).

## Procédure de smoke tests prod (décrite — NON exécutée)
> À exécuter **après** un déploiement autorisé (hors périmètre M15, aucune action prod ici) :
1. `GET https://<host>/status` ⇒ `worker up`, `d1 up`, `kv up`, `gateway` selon heartbeat.
2. Login Studio opérateur (cookie `studio_session` distinct), `GET /studio-api/metrics` ⇒ agrégats.
3. `GET /studio-api/errors` ⇒ top erreurs récentes.
4. Rollout : `PUT /studio-api/rollout/platform.entitlements` avec 1 guilde pilote ⇒ `resolveGuildFlag` true pour elle uniquement ; vérifier l'entrée `audit_events` ; puis **retirer** la cohorte (rollback).
5. Vérifier qu'aucune route `/studio-api/*` ne répond sur le domaine client (404).

## Commits
| Hash | Message |
|------|---------|
| `ac72307` | `docs(platform): M15 execution brief` (poussé seul sur `master` avant la branche) |
| `a598ea9` | `feat(worker): studio metrics/errors dashboards, public /status, cohort rollout (M15)` |
| `2caa57e` | `feat(developer-studio): metrics, errors & rollout panels (M15)` |
| `06d97a6` | `test(platform): cover observability aggregation, status & cohort rollout (M15)` |
| _(ce rapport)_ | `docs(platform): M15 completion report` |

## Confirmations
- **Aucune PII** dans les métriques (agrégation pseudonymisée) · `/status` = santé composants · **rollout par cohortes sans redeploy** (KV), audité, **opt-in** (aucune régression) · **consultation seule** (aucun déclenchement de déploiement, D26) · dashboards gardés `deployments.read`, édition `features.manage` · dev-auth serveur & isolation host inchangés · **aucune migration** · **aucune dépendance/lockfile** · **aucune migration distante** · **aucun secret prod / clé live / paiement** · **aucun déploiement / bascule DNS** · **flags off en prod** · M16 non commencé.

## Rollback
- **Fonctionnel** : `platform.studio` off ⇒ dashboards/rollout injoignables ; rollout global off + cohortes vides ⇒ aucun effet ; `/status` = lecture santé inerte. Données conservées.
- **Code** : `git revert` du merge `master..feat/m15-observability-rollout`. **Aucune migration** ⇒ rien à défaire côté D1.

## Décisions consommées
- **D19** (bêta fermée par cohortes), **D25** (vitest, E2E/charge différés), **D26** (déploiements = consultation seule), **D14** (`/status` minimal).
- **Débloque** : M16 (lancement commercial) — rollout + observabilité en place pour activer par cohortes puis en général.
