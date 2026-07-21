# Rapport de fin de milestone — M14 · Audit immuable & sécurité renforcée

> Brief : [../briefs/M14-brief.md](../briefs/M14-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m14--audit-immuable--sécurité-renforcée) · Données : [../../08-data-model.md](../../08-data-model.md) · Sécurité : [../../09-security-model.md](../../09-security-model.md) · E2 §7 (D24/D27) · [rapport M13](./M13-report.md)

## Résumé

M14 est **terminé et vert**. **Audit immuable & sécurité renforcée** pour le Studio M12/M13. Table **`audit_events` append-only** (aucune route UPDATE/DELETE, distincte de `admin_audit_log`) : chaque mutation opérateur sensible (grant / lifetime / révocation) écrit **1 entrée immuable** avec **metadata masquée** (`email`/`token`/`secret`/… → `***`) et **`ip_hash`** HMAC (jamais l'IP brute). Consultation **lecture seule** via `GET /studio-api/audit` (`audit.read`). **Durcissement** : **step-up** (ré-authentification OAuth `prompt=consent`, horodatée `stepUpAt` < 10 min) exigé sur le **lifetime** ; **rate-limits par (opérateur, action)** (KV) sur grant/lifetime/révocation ; **kill-switch** `STUDIO_KILL_SWITCH` (503 immédiat sur le host studio, host client toujours 404). **Backend = vérité.** Onglet **Audit** + flow **step-up** dans la SPA. Réutilise **`platform.studio`** (off). **Aucune dépendance nouvelle, aucune migration distante, aucun secret prod, aucun paiement, aucun déploiement, aucune purge d'audit.**

- **Branche** : `feat/m14-audit-hardening`
- **HEAD initial** (master) : `bbd60ed` (brief M14)
- **HEAD final** : `d8a50be` (avant le commit du présent rapport)

## Livré

### Migration `0039_audit_events.sql` (additive, append-only)
- `audit_events` : `id` PK · `actor` (`operator:<id>`/`system`, NOT NULL) · `action` (NOT NULL) · `target_type`/`target_id` · `metadata_json` (**masqué**) · `ip_hash` · `created_at`. Index `(actor, created_at DESC)`, `(action, created_at DESC)`, `(target_type, target_id)`. **Aucune route UPDATE/DELETE, aucune purge, aucun SQL destructif.**

### `@bot/shared`
- `api-types/audit.ts` : `StudioAuditEvent`, `StudioAuditPage` (`Paginated`), `StudioAuditFilters`. (Masquage = serveur.)

### Worker
- `security/studio-audit.ts` : **`maskAuditMetadata`** pur (masque récursivement `email|token|secret|password|authorization|ip|apiKey` en `***`, conserve `reason`/`planId`…), **`hashIpForAudit`** (HMAC-SHA256 sur `SESSION_SECRET`, jamais l'IP brute), **`writeStudioAudit`** (metadata masquée + `ip_hash`), `callerIp` (`cf-connecting-ip`).
- `db/queries/audit-events.ts` : `insertAuditEvent`, `listAuditEvents` (filtres actor/action/target, paginé, `created_at DESC`). **Pas de mutation/suppression.**
- `auth/studio-session.ts` : champ `stepUpAt?` + **`markStudioStepUp`** (préserve le TTL).
- `auth/studio-guard.ts` : **`requireStepUp(10 min)`** (403 `step_up_required`), **`studioActionRateLimit`** (KV `studio:rl:<action>:<op>:<bucket>`, 429), kill-switch dans `requireStudioHost` (503 `studio_disabled` sur host studio).
- `auth/studio-oauth.ts` : `GET /studio/auth/step-up` + `/step-up/callback` (OAuth `prompt=consent`, **même opérateur** que la session, stamp `stepUpAt` ; ne crée pas de session).
- `api/studio-grants.ts` (retrofit M13) : grant/lifetime/révocation ⇒ `studioActionRateLimit` + **`writeStudioAudit`** ; `grant_lifetime` ⇒ **`requireStepUp`**.
- `api/studio.ts` : `GET /studio-api/audit` (`audit.read`, lecture seule).
- `env.ts` : `STUDIO_KILL_SWITCH?` (pas de secret nouveau ; `ip_hash` réutilise `SESSION_SECRET`).

### SPA `@bot/developer-studio`
- Onglet **Audit** (gardé par `audit.read`) : date/acteur/action/cible. Flow **step-up** : `step_up_required` ⇒ lien **« Ré-authentifier »** → `/studio/auth/step-up`.

## Règles (backend = vérité)
- **Append-only** : `audit_events` sans route d'écriture/suppression ; chaque mutation sensible ⇒ 1 entrée (invariant 5 complété).
- **Masquage** : secrets/PII → `***` ; **`ip_hash`** (jamais l'IP brute).
- **Step-up** : lifetime exige une ré-auth OAuth < 10 min (même opérateur) ; sinon 403.
- **Rate-limits** par (opérateur, action) ; **kill-switch** ⇒ 503 host studio, host client **toujours 404** (aucune fuite).
- Host-gating, dev-auth serveur, `paid` non révocable, isolation cookie **inchangés**.

## Fichiers (16 · +613 / −13)

```
 packages/worker/migrations/0039_audit_events.sql |  +28
 packages/shared/src/api-types/audit.ts           |  +27
 packages/shared/src/api-types/index.ts           |   +1
 packages/worker/src/security/studio-audit.ts     |  +66
 packages/worker/src/db/queries/audit-events.ts   |  +82
 packages/worker/src/db/queries.ts                |   +1
 packages/worker/src/auth/studio-session.ts       |  +24  (stepUpAt + markStudioStepUp)
 packages/worker/src/auth/studio-guard.ts         |  +44  (requireStepUp, rate-limit, kill-switch)
 packages/worker/src/auth/studio-oauth.ts         |  +68  (step-up OAuth)
 packages/worker/src/api/studio-grants.ts         |  +49  (retrofit audit + rate-limit + step-up)
 packages/worker/src/api/studio.ts                |  +32  (GET /studio-api/audit)
 packages/worker/src/env.ts                        |   +3  (STUDIO_KILL_SWITCH)
 packages/developer-studio/src/App.tsx            |  +40  (onglet Audit + step-up)
 packages/developer-studio/src/api.ts             |   +7
 packages/worker/test/studio-audit.test.ts        | +144  (9 tests)
 packages/worker/test/studio-grants.test.ts       |  +10  (ajustement step-up)
```
**Non touchés** : Gateway, `packages/panel`, `wrangler.jsonc`, `package.json`, **lockfile**, migrations antérieures, `@bot/ui`.

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 6/6 |
| Tests Worker — `studio-audit` | ✅ **9/9** |
| Régression Worker (`studio`/`studio-grants`/`entitlements`/`release-notes`) | ✅ **44/44** |
| Build panel + budget | ✅ **153.1 kB / 180 kB** (inchangé) |
| Build `@bot/developer-studio` | ✅ (64.1 kB gzip — budget Studio séparé) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check` (staged) | ✅ propre |
| Migration `0039` sur base propre | ✅ (appliquée par `apply-migrations` ⇒ suite audit verte) |

> **Limitation d'environnement** (identique M11–M13) : nettoyage temp miniflare `EBUSY` sous Windows + suite Worker complète instable (loopback) → suites par lots, **zéro échec d'assertion**.

## Couverture des tests (9 worker + ajustement M13)
`maskAuditMetadata` pur (secrets → `***`, `reason` conservé) · `hashIpForAudit` (≠ IP brute, null si absent) · grant ⇒ **1 `audit_events`** (acteur/cible) · stockage masqué + `ip_hash` (jamais l'IP) · **append-only** (DELETE/PATCH `/audit` ⇒ 404) · lecture gardée `audit.read` (403/200) · **step-up** lifetime (403 `step_up_required` sans / 201 avec) · **rate-limit** grant (429 au-delà de la limite) · **kill-switch** (503 host studio, 404 host client). Ajustement : les tests lifetime M13 établissent d'abord le step-up (durcissement documenté).

## Commits
| Hash | Message |
|------|---------|
| `bbd60ed` | `docs(platform): M14 execution brief` (poussé seul sur `master` avant la branche) |
| `3ddd44a` | `feat(worker): immutable audit_events + step-up, rate-limits, kill-switch (M14)` |
| `930e974` | `feat(developer-studio): audit log view + step-up flow (M14)` |
| `d8a50be` | `test(platform): cover audit immutability, step-up, rate-limits & masking (M14)` |
| _(ce rapport)_ | `docs(platform): M14 completion report` |

## Confirmations
- **Audit append-only** (aucune route UPDATE/DELETE, aucune purge) · chaque mutation sensible ⇒ 1 entrée immuable · **PII/secrets masqués**, **`ip_hash`** (jamais l'IP brute) · **step-up** ré-auth obligatoire sur lifetime (même opérateur) · **rate-limits** par opérateur/action · **kill-switch** sans fuite côté client · `paid` non révocable & isolation host/cookie **inchangés** · **aucune dépendance/lockfile** · **aucune migration distante** · **aucun secret prod / clé live / paiement réel** · **aucun déploiement** · **flag `platform.studio` off en prod** · M15 non commencé.

## Rollback
- **Fonctionnel** : `platform.studio` off ⇒ Studio injoignable ; `STUDIO_KILL_SWITCH` ⇒ coupe-circuit immédiat ; audit conservé (jamais purgé).
- **Code** : `git revert` du merge `master..feat/m14-audit-hardening`. Migration `0039` **additive** (table vide) → revert la laisse inutilisée ; **aucun `DROP`**.

## Décisions consommées
- **D24** (step-up) : ré-auth OAuth récente sur lifetime (cible renforcée après le défaut M13).
- **D27** (env prod/dev) : kill-switch + bandeau PRODUCTION ; environnements formellement séparés = ultérieur.
- **Débloque** : M15 (déploiement progressif & observabilité) — dashboards s'appuient sur l'audit/les métriques ; second-opérateur/MFA = cible ultérieure.
