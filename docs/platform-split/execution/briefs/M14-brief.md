# Brief d'exécution — M14 · Audit immuable & sécurité renforcée

> Voir aussi : [milestones](../E4-milestones.md#m14--audit-immuable--sécurité-renforcée) · [studio](../../04-developer-studio.md) · [données](../../08-data-model.md) · [sécurité](../../09-security-model.md) · [E2 §7 (D24/D27)](../E2-decision-fiches.md) · [E7 déc.24/27](../E7-decision-queue.md) · [rapport M13](../reports/M13-report.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m14-audit-hardening` après commit + push de ce brief sur `master`. **Studio uniquement — durcit les mutations M12/M13. Aucun paiement, aucune clé, aucune migration distante, aucun déploiement.**

## 1. Contexte

- **Après M12/M13** : Studio isolé host-gated, dev-auth `requireDeveloper`, `studioMutationOrigin`, session `studio_session` (`sameSite=Strict`). Grants manuels & lifetime (`developer_grants`, `subscriptions.grant`/`grant_lifetime`/`revoke_granted`), révocation qui n'affecte jamais un `paid`, `subscription_events` (`actor='operator:<id>'`). Audit **panel** existant `admin_audit_log(_v2)` (guild-scopé). Migrations locales jusqu'à **`0038`**. Tout off en prod.
- **But de M14** : **journal d'audit `audit_events` immuable (append-only)** pour toute mutation opérateur sensible (grants/lifetime/révocations, publications, à venir : flags/permissions), **consultable** via `/studio-api/audit` (`audit.read`), avec **masquage PII/secrets** et **`ip_hash`**. Plus le **durcissement** : **step-up (ré-authentification OAuth récente)** sur le lifetime (financier), **rate-limits par opérateur/action**, **kill-switch studio**. **Backend = vérité.**

## 2. Décisions consommées

| # | Décision | Choix M14 | Réf. |
|---|----------|-----------|------|
| D24 | Step-up | **Ré-auth OAuth récente** (`prompt=consent`) horodatée sur la session (`stepUpAt`) ; `requireStepUp(10 min)` sur le **lifetime**. (Le défaut M13 = confirmation + saisie ; M14 = cible renforcée.) | E7 déc.24, E2 §7 |
| D27 | Env prod/dev | Bandeau PRODUCTION (M12) + **kill-switch** `STUDIO_KILL_SWITCH` (503 immédiat) ; environnements séparés formalisés = ultérieur. | E7 déc.27 |
| m14.1 | Audit | Table **`audit_events`** neuve (append-only, **aucune route UPDATE/DELETE**), distincte de `admin_audit_log` (panel/guild). Étend l'esprit vers le studio (doc 08). Retrofite les mutations M13. | doc 08/09 |
| m14.2 | Masquage | `metadata_json` : clés sensibles (`email`/`token`/`secret`/`password`/`authorization`/`ip`) **masquées** ; `ip_hash` HMAC (jamais l'IP brute). | doc 09 §8/9 |
| m14.3 | Rate-limits | Compteur **KV par (opérateur, action, fenêtre)** sur `grant`/`grant_lifetime`/`revoke_granted` ⇒ 429. | doc 09 §6 |

## 3. Hors périmètre (interdit — M15/M16)

- ❌ **Erreurs/métriques/dashboards/rollout par cohortes/déclenchement de déploiement** = **M15**.
- ❌ **Double validation second opérateur**, MFA propre, WAF, environnements prod/dev formellement séparés = cible ultérieure (E2 Fiche 7.1 colonne « cible »).
- ❌ `refund_paid`/`cancel_paid` (workflows payés) — non implémentés ; le step-up est **prêt** à les couvrir mais aucun workflow payé n'est ajouté ici.
- ❌ Nouvelle dépendance ; secret prod ; clé live ; paiement réel ; migration distante ; déploiement ; migration destructive ; activation de flag en prod ; **purge/suppression de l'audit** (append-only).
- ❌ Tout travail M15/M16.

## 4. Modèle de données — migration `0039_audit_events.sql` (additive, [doc 08])

### `audit_events` (append-only)
`id` PK AUTOINCREMENT · `actor` (`operator:<id>` | `system`, NOT NULL) · `action` (NOT NULL, ex. `subscriptions.grant_lifetime`) · `target_type` (nullable) · `target_id` (nullable) · `metadata_json` (**secrets/PII masqués**) · `ip_hash` (nullable) · `created_at`.
Index : `(actor, created_at DESC)`, `(action, created_at DESC)`, `(target_type, target_id)`.
**Append-only** : aucune route UPDATE/DELETE ; **aucun SQL destructif** ; aucune purge (rétention longue, doc 08).

## 5. `@bot/shared`

- `api-types/audit.ts` : `StudioAuditEvent` (id, actor, action, targetType, targetId, metadata (objet), createdAt), `StudioAuditPage` (`Paginated<StudioAuditEvent>`), `StudioAuditFilters` (actor?/action?/targetType?/targetId?). (Masquage = **serveur**.)

## 6. Worker

### `security/studio-audit.ts`
- `maskAuditMetadata(meta)` **pur** : masque récursivement les clés sensibles (`email|token|secret|password|authorization|ip|apiKey`) en `"***"`, conserve la structure et la justification (`reason`).
- `hashIpForAudit(secret, ip)` : HMAC-SHA256 → hex (jamais l'IP brute).
- `writeStudioAudit(env, {actor, action, targetType?, targetId?, metadata?, ip?})` : insère 1 `audit_events` (metadata masquée + `ip_hash`). Best-effort (`waitUntil`), n'échoue jamais la requête.

### `db/queries/audit-events.ts`
- `insertAuditEvent`, `listAuditEvents({actor?, action?, targetType?, targetId?, page, pageSize})` (tri `created_at DESC`, paginé, borné).

### Durcissement `auth/studio-session.ts` + `auth/studio-guard.ts`
- Session : champ **`stepUpAt?: number`** ; `markStudioStepUp(env, sid)` (met `stepUpAt=now`). `requireStepUp(maxAgeMs=600_000)` ⇒ **403 `step_up_required`** si absent/périmé.
- `requireStudioHost` : si `STUDIO_KILL_SWITCH==='true'` sur le host studio ⇒ **503 `studio_disabled`** (le host client reste 404, aucune fuite).
- `studioActionRateLimit(action, max, windowSec)` : compteur KV `studio:rl:<action>:<operator>:<bucket>` ⇒ **429 `rate_limited`**.

### `auth/studio-oauth.ts`
- `GET /studio/auth/step-up` (OAuth `prompt=consent`, state `studio_stepup_state`) + `GET /studio/auth/step-up/callback` : vérifie l'utilisateur = opérateur courant, appelle `markStudioStepUp` sur la **session en cours**, redirige. **Ne crée pas** de nouvelle session.

### Retrofit M13 (`api/studio-grants.ts`)
- `grant` / `grant_lifetime` / `revoke_granted` : ajoutent `studioActionRateLimit` + **`writeStudioAudit`** (action = permission, `targetType='entitlement'`/`'user'`, metadata masquée). `grant_lifetime` ajoute **`requireStepUp`**.

### API `api/studio-audit.ts`
- `GET /studio-api/audit` → `requireDeveloper('audit.read')` : liste filtrée/paginée. **Aucune** route d'écriture/suppression (append-only).

### Env
- `env.ts` : `STUDIO_KILL_SWITCH?`. (Pas de secret nouveau : `ip_hash` réutilise `SESSION_SECRET`.)

## 7. SPA `@bot/developer-studio`

- Onglet **Audit** (gardé par `audit.read`) : liste (date, acteur, action, cible) filtrable. Flow **step-up** : si une action lifetime renvoie `step_up_required`, afficher un lien **« Ré-authentifier »** → `/studio/auth/step-up`. Budget Studio séparé ; panel client inchangé.

## 8. Sécurité & isolation (invariants testés)

- **Audit append-only** : `audit_events` sans route UPDATE/DELETE ; chaque mutation sensible ⇒ **1 entrée** (invariant 5 complété).
- **PII/secrets masqués** ; **`ip_hash`** (jamais l'IP brute).
- **Step-up** obligatoire sur le lifetime (ré-auth < 10 min) ⇒ un lifetime ne peut être accordé sans ré-consentement récent.
- **Rate-limits** par opérateur/action (anti-abus grants).
- **Kill-switch** ⇒ 503 immédiat sur le host studio (host client toujours 404).
- Host-gating, dev-auth serveur, `paid` non révocable, isolation cookie **inchangés**.

## 9. Feature flag

Réutilise **`platform.studio`** (off). Kill-switch `STUDIO_KILL_SWITCH` = coupe-circuit additionnel (absent par défaut).

## 10. Tests (`studio-audit.test.ts` + ajustement `studio-grants.test.ts`)

1. `maskAuditMetadata` pur (email/token/secret masqués ; reason conservé) ; `ip_hash` ≠ IP brute.
2. Grant / revoke / lifetime ⇒ **1 `audit_events`** (action correcte, `actor='operator:<id>'`).
3. **Append-only** : `DELETE`/`PATCH` sur `/studio-api/audit` ⇒ 404 (aucune route).
4. **Step-up** : lifetime **sans** step-up récent ⇒ 403 `step_up_required` ; **avec** (`markStudioStepUp`) ⇒ 201.
5. **Rate-limit** : > max grants dans la fenêtre ⇒ 429.
6. `audit.read` : `GET /studio-api/audit` sans permission ⇒ 403 ; avec ⇒ 200 (liste filtrable).
7. **Kill-switch** : `STUDIO_KILL_SWITCH='true'` ⇒ `/studio-api/*` 503 ; host client toujours 404.
8. **Ajustement M13** : le test lifetime-succès établit d'abord le step-up (`markStudioStepUp`) — comportement durci documenté (M13 notait « ré-auth = M14 »).

**Validations** : `pnpm -r check` ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** ; build `@bot/developer-studio` ; `wrangler deploy --dry-run` ; `git diff --check`.

## 11. Critères d'acceptation

1. `0039` s'applique sur base propre ; **additif**, **append-only**, aucun `DROP`.
2. Chaque mutation sensible ⇒ **1 `audit_events`** immuable (metadata masquée, `ip_hash`).
3. Lifetime **impossible** sans step-up récent (ré-auth < 10 min).
4. Rate-limits appliqués ; kill-switch coupe le studio (503) sans fuite côté client.
5. `/studio-api/audit` lisible sous `audit.read` ; **aucune** écriture/suppression d'audit.
6. Aucune dépendance/migration distante/déploiement/clé/paiement ; budget panel inchangé.
7. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 12. Rollback

- **Fonctionnel** : `platform.studio` off ⇒ Studio injoignable ; `STUDIO_KILL_SWITCH` ⇒ coupe-circuit ; audit conservé.
- **Code** : `git revert` du merge `master..feat/m14-audit-hardening`. Migration `0039` **additive** (table vide) → revert la laisse inutilisée ; **aucun `DROP`**.

## 13. Stratégie de commits (Conventional + réf `M14`)

```
docs(platform): M14 execution brief                                            # poussé seul sur master AVANT la branche
feat(worker): immutable audit_events + step-up, rate-limits, kill-switch (M14)  # migration 0039 + shared DTO + audit write/read + hardening + retrofit
feat(developer-studio): audit log view + step-up flow (M14)
test(platform): cover audit immutability, step-up, rate-limits & masking (M14)
docs(platform): M14 completion report
```
Merge **fast-forward** après validation.

## 14. Rapport final attendu

`docs/platform-split/execution/reports/M14-report.md` : modèle `audit_events` (append-only), écriture/masquage/`ip_hash`, step-up ré-auth, rate-limits, kill-switch, retrofit M13, lecture `/audit`, budget, diffstat, hashes, commits, validations, confirmations.

---

## Micro-décisions M14 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m14.1 | Table audit | **`audit_events`** neuve append-only (distincte de `admin_audit_log`) |
| m14.2 | Step-up | ré-auth OAuth `prompt=consent`, `stepUpAt` < 10 min, sur lifetime |
| m14.3 | Masquage | clés sensibles → `***` ; `ip_hash` HMAC (jamais l'IP brute) |
| m14.4 | Rate-limit | KV par (opérateur, action, fenêtre) sur grant/lifetime/revoke |
| m14.5 | Kill-switch | `STUDIO_KILL_SWITCH` ⇒ 503 host studio (client toujours 404) |
| m14.6 | Purge audit | **aucune** (append-only, rétention longue) |
