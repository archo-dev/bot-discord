# Brief d'exécution — M15 · Déploiement progressif & observabilité

> Voir aussi : [milestones](../E4-milestones.md#m15--déploiement-progressif--observabilité) · [studio](../../04-developer-studio.md) · [roadmap](../../11-migration-roadmap.md) (étapes 17–18) · [tests & release](../../12-testing-and-release-strategy.md) · [sécurité](../../09-security-model.md) · [décisions D19/D25/D26/D27](../../13-open-decisions.md) · [rapport M14](../reports/M14-report.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m15-observability-rollout` après commit + push de ce brief sur `master`. **Studio + statut public. Aucun déploiement, aucune migration distante, aucune activation de flag en prod, aucune bascule DNS.**

## 1. Contexte

- **Après M12–M14** : Studio isolé (host-gated, dev-auth `requireDeveloper`, matrice 13 permissions), grants/lifetime (M13), audit immuable + step-up + rate-limits + kill-switch (M14). Télémétrie existante : `operation_metrics` (par-guilde **pseudonymisée** `guildKey`, buckets de latence, `error_count`) alimentée par `requestTelemetry` ; `listHealthMetrics`/`purgeObservabilityMetrics` ; heartbeat gateway en KV `gateway:status`. **Aucun** endpoint `/status` public à ce jour ; santé uniquement par-guilde (`/api/guilds/:id/health`). Migrations locales jusqu'à **`0039`** ; tout off en prod.
- **But de M15** : **voir ce qui se passe** et **activer par cohortes**. (1) Dashboards Studio **erreurs** & **métriques** (agrégation cross-guilde de `operation_metrics`, `deployments.read`). (2) **`/status` public enrichi** (Worker/Gateway/D1/KV, sans PII). (3) **Rollout progressif par cohortes** : mécanisme **KV** (sans redeploy) activant un flag pour des guildes pilotes → général (`features.manage`), avec résolveur pur. **Backend = vérité, pas de PII dans les métriques.**

## 2. Décisions consommées

| # | Décision | Choix M15 | Réf. |
|---|----------|-----------|------|
| D19 | Lancement bêta | **Bêta fermée** : rollout par cohortes de guildes pilotes via KV (sans redeploy), défaut global off. | E7 déc.25, doc 11 étape 17 |
| D25 | Outillage E2E/charge/a11y | **Réutiliser vitest** (unitaire/intégration) ; Playwright/k6/axe **différés** (hors code M15). | doc 12, D25 |
| D26 | Déclenchement déploiements Studio | **Consultation seule** : dashboards lisent ; **aucun** déclenchement de déploiement depuis le Studio (CLI hors périmètre). | E7 déc.26, doc 04 |
| D14 | `/status` public | **Minimal** : composants up/degraded/down + âge heartbeat ; **aucun détail sensible**. | doc 13 D14 |
| m15.1 | Migration | **Aucune** (réutilise `operation_metrics`). | — |
| m15.2 | PII métriques | Agrégation **cross-guilde** sur `guildKey` **déjà pseudonymisé** ; jamais d'ID brut. | doc privacy-analytics |

## 3. Hors périmètre (interdit — M16 / ultérieur)

- ❌ **Activation du paiement / prix réels / CGV publiées / go-live** = **M16**.
- ❌ **Déclenchement de déploiement** depuis le Studio (consultation seule, D26) ; bascule DNS ; smoke tests **exécutés en prod** (le brief décrit la procédure, ne l'exécute pas).
- ❌ Rewire des consommateurs de flags **synchrones** existants (`getWorkerFlags`) — le rollout cohorte est **additif/opt-in**, il ne modifie **aucun** chemin existant (global off = comportement inchangé).
- ❌ Nouvelle dépendance ; secret prod ; clé live ; paiement ; migration distante ; déploiement ; migration destructive ; activation de flag en prod.
- ❌ Tout travail M16.

## 4. Modèle de données

**Aucune migration** (m15.1). Réutilise `operation_metrics` (0020) et le KV pour le store de rollout (clés `platform:rollout:<flag>`, TTL long, jamais de PII).

## 5. `@bot/shared`

- `api-types/observability.ts` : DTOs `StudioMetricsSummary` (par module : `events`, `errors`, `errorRate`, buckets de latence, `lastObservedAt`), `StudioMetricsResponse`, `StudioErrorsResponse` (top modules/opérations en erreur), `PublicStatus` (composants `worker|gateway|d1|kv` → `up|degraded|down` + `heartbeatAgeSeconds`), `RolloutFlagState` (`flag`, `global`, `guilds[]`), `RolloutResponse`.
- **`resolveRollout({ globalOn, cohortGuilds, guildId })`** **pur/déterministe** → `boolean` (`globalOn || (guildId && cohortGuilds.includes(guildId))`). Testable sans I/O.

## 6. Worker

### Queries
- `db/queries/observability.ts` (+studio) : `aggregateMetricsForStudio(db, hours)` (SUM cross-guilde par module : events/samples/errors/buckets/lastObserved), `topErrorsForStudio(db, hours, limit)` (modules/opérations à plus fort `error_count`). Bornés, **jamais** d'ID guilde brut.
- `db/queries/rollout.ts` (**KV**, pas de D1) : `getRollout(kv, flag)`, `setRollout(kv, flag, state)`, `listRollout(kv, flags)` — `platform:rollout:<flag>` → JSON `{ global?: boolean; guilds: string[] }`. Validation stricte (snowflakes bornés).
- `config/rollout.ts` : **`resolveGuildFlag(env, kv, flag, guildId)`** async = flag global (`getWorkerFlags`) **OU** cohorte KV (`resolveRollout`) — résolveur **opt-in** (aucun consommateur existant modifié).

### API
- `api/status.ts` : **`GET /status`** public (hors session) — `worker: up`, `gateway` (heartbeat KV `gateway:status` + âge, degraded si > 180 s), `d1` (`SELECT 1`), `kv` (ping). Sans PII. Monté à la racine avant `/api`.
- `api/studio.ts` (+) : `GET /studio-api/metrics` (`deployments.read`), `GET /studio-api/errors` (`deployments.read`), `GET /studio-api/rollout` (`deployments.read`), `PUT /studio-api/rollout/:flag` (`features.manage` + `studioMutationOrigin` + **`writeStudioAudit`**). Flags reconnus uniquement (catalogue `PLATFORM_FLAGS`).

### Câblage
- `/status` monté à la racine (public). Aucune modification des routers existants.

## 7. SPA `@bot/developer-studio`

- Onglets **Métriques** (`deployments.read`, tableau par module : events, taux d'erreur, latence), **Erreurs** (`deployments.read`, top erreurs), **Rollout** (`features.manage` requise pour éditer ; sinon lecture `deployments.read`) : par flag, bascule global + liste de guildes pilotes. Budget Studio séparé ; panel client inchangé.

## 8. Sécurité & isolation (invariants testés)

- Dashboards **lecture seule** (`deployments.read`) ; édition rollout = `features.manage` + Origin + **audit**.
- **Aucune PII** : agrégation sur `guildKey` **pseudonymisé** ; `/status` n'expose que des états de composants.
- Host-gating, dev-auth serveur, isolation cookie **inchangés** ; rollout cohorte **additif** (global off ⇒ zéro changement de comportement, aucune régression).
- **Rollback** : masquer les onglets / rollout global off ⇒ données conservées ; `/status` reste inerte (lecture santé).

## 9. Feature flag

Réutilise **`platform.studio`** (off) pour les routes studio. Le **store de rollout** est off par défaut (aucune cohorte) ⇒ aucun effet. `/status` non gated (opérationnel, lecture santé).

## 10. Tests (`studio-observability.test.ts`, `status.test.ts`)

1. `resolveRollout` pur (global on ⇒ true ; global off + guilde ∈ cohorte ⇒ true ; sinon false).
2. `aggregateMetricsForStudio` : seed `operation_metrics` (2 guildes) ⇒ totaux cross-guilde corrects par module.
3. `topErrorsForStudio` : modules à erreurs classés.
4. `/status` : forme (`worker up`, `gateway` degraded si pas de heartbeat, `d1`/`kv` up) ; **aucun** ID guilde.
5. Rollout KV : `set`/`get`/`list` ; `PUT /studio-api/rollout/:flag` audité (`audit_events`) ; validation snowflakes.
6. Permissions : `/metrics`/`/errors` sans `deployments.read` ⇒ 403 ; `PUT rollout` sans `features.manage` ⇒ 403.
7. Isolation host : `/studio-api/metrics` ⇒ 404 host client.
8. `resolveGuildFlag` : global off + cohorte KV contenant la guilde ⇒ true (opt-in), sans toucher les consommateurs existants.

**Validations** : `pnpm -r check` ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** ; build `@bot/developer-studio` ; `wrangler deploy --dry-run` ; `git diff --check`.

## 11. Critères d'acceptation

1. Dashboards **métriques/erreurs** exacts (agrégation cross-guilde, sans PII), gardés `deployments.read`.
2. **`/status`** reflète Worker/Gateway/D1/KV réels, sans détail sensible.
3. **Rollout par cohortes** activable/désactivable **sans redeploy** (KV), audité, résolveur pur testé, **opt-in** (aucune régression).
4. Aucune migration/dépendance/déploiement/activation prod ; budget panel inchangé.
5. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 12. Rollback

- **Fonctionnel** : `platform.studio` off ⇒ dashboards/rollout injoignables ; rollout global off + cohortes vides ⇒ aucun effet ; `/status` = lecture santé inerte. Données conservées.
- **Code** : `git revert` du merge `master..feat/m15-observability-rollout`. **Aucune migration** ⇒ rien à défaire côté D1.

## 13. Stratégie de commits (Conventional + réf `M15`)

```
docs(platform): M15 execution brief                                          # poussé seul sur master AVANT la branche
feat(worker): studio metrics/errors dashboards, public /status, cohort rollout (M15)
feat(developer-studio): metrics, errors & rollout panels (M15)
test(platform): cover observability aggregation, status & cohort rollout (M15)
docs(platform): M15 completion report
```
Merge **fast-forward** après validation.

## 14. Rapport final attendu

`docs/platform-split/execution/reports/M15-report.md` : dashboards (agrégation sans PII), `/status`, rollout cohorte (KV, sans redeploy, audité, opt-in), budget, diffstat, hashes, commits, validations, **procédure de smoke tests prod (décrite, non exécutée)**, confirmations.

---

## Micro-décisions M15 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m15.1 | Migration | **aucune** (réutilise `operation_metrics`) |
| m15.2 | PII | agrégation sur `guildKey` pseudonymisé ; `/status` = états de composants |
| m15.3 | Rollout | store **KV** (`platform:rollout:<flag>`), résolveur pur, **opt-in** (consommateurs existants non modifiés) |
| m15.4 | Déploiements Studio | **consultation seule** (D26) ; aucun déclenchement |
| m15.5 | `/status` | **public, minimal** (D14), non gated |
