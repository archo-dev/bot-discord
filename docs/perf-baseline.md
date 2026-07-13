# M04 — Baseline performance et budgets

> Mesures de référence prises sur `milestone/performance-budgets` au départ de `fe59b54`
> (tag `restore/pre-m04-performance`). Ce document fige l'état **avant** optimisation
> et sert de contrat de comparaison. Les valeurs prod (p50/p95 réels, ratios de cache KV,
> métriques Cloudflare) ne sont pas accessibles en lecture sûre : les cibles chiffrées
> restent des budgets à valider après instrumentation, pas des mesures de production.

## Méthode de mesure

- **Bundle** : `pnpm --filter @bot/panel build` (Vite 6), tailles brutes = `wc -c`,
  tailles gzip = `gzip -c <fichier> | wc -c` sur `packages/panel/dist/assets/`.
  Le budget automatisé (C6) rejoue exactement ce calcul.
- **Lectures D1 par requête** : comptage statique des appels `db.prepare(...).run/all/first`
  et `db.batch` sur le chemin lu ; une entrée de `Promise.all` compte pour un aller-retour.
- **Appels Worker sur cache froid concurrent** : lecture du protocole `config-cache` gateway
  (nombre de `api.getGuildConfig` déclenchés pour N `get()` simultanés, même guilde, cache vide).
- **Retries Discord** : lecture de `worker/src/discord/rest.ts` (nombre de tentatives,
  conditions, respect de `Retry-After`, jitter).

## Bundle panel — AVANT

| Asset | Brut | gzip |
|---|---:|---:|
| `assets/index-*.js` (chunk unique) | **1 018 374 o** | **294 424 o** |
| `assets/index-*.css` | 50 594 o | 9 739 o |
| **Total JS initial** | **1 018 374 o** | **294 424 o** |

- **1 seul chunk JS** — 817 modules, avertissement Vite « chunks > 500 kB ».
- Les 22 pages sont importées statiquement dans `App.tsx` (aucun `React.lazy`).
- Recharts n'est consommé que par `pages/Stats.tsx` (via `ui/charts.tsx`) mais il est
  embarqué dans le chunk initial de toutes les routes.
- `vite.config.ts` : aucun `manualChunks`, aucun budget.

**Cible retenue (spec §14/20) : JS initial gzip < 180 kB (184 320 o).**

## Chemin `/internal/guilds/:guildId/config` — AVANT

Chemin appelé par le cache gateway (`config-cache`, TTL 60 s). Lectures D1 :

1. `getGuild`
2. `listAutoRoles` ┐ `Promise.all` (1 aller-retour)
3. `listEffectiveGuildModules` ┘
4. `getWelcomeSettings` (séquentiel)
5. `getLogSettings` (séquentiel)
6. `getAutomodSettings` (séquentiel)
7. `getXpSettings` (séquentiel)
8. `getStarboardSettings` (séquentiel)
9. `getTempVoiceSettings` (séquentiel)

**= 9 lectures D1 en ~8 allers-retours quasi séquentiels** (les propriétés de l'objet
réponse sont évaluées et `await`ées dans l'ordre source). Aucune ne dépend du résultat
d'une autre : parallélisables en 1 aller-retour.

## Cache gateway `config-cache` — AVANT

`createConfigCache` : `Map` guildId → { value, expiresAt }, TTL 60 s.
Sur cache froid, **aucune coalescence** : N appels `get(guildId)` concurrents pour la même
guilde déclenchent **N** appels `api.getGuildConfig` (stampede). Les valeurs `null` sont
mises en cache 60 s comme les autres.

## Discord REST `discordRequest` — AVANT

- 1 tentative + **1 seul retry**, uniquement sur **429**.
- `Retry-After` respecté (plafonné à 5 s).
- Aucun retry sur **5xx**, aucun **jitter**, headers `x-ratelimit-*` ignorés.
- Retry appliqué indistinctement (GET comme mutations) — mais un seul, donc risque faible.
- Aucune coordination du bucket global 50 req/s entre Worker et Gateway.

## Index D1

Couverture composite solide sur tous les parcours chauds (`voice_logs`, `mod_actions`,
`tickets`, `xp_members`, `channel_activity`, `admin_audit_log`, `guild_modules`,
`custom_commands`, …). **Aucun index ajouté en M04** : tout ajout exigerait une preuve
`EXPLAIN QUERY PLAN` et une validation préalable.

## Hors périmètre M04 (dette documentée)

- **P5 — Livraison fiable Gateway → Worker.** `worker-api.call()` n'a aucun retry (fetch
  unique, timeout 10 s) ; hors voice-logs (bufferisés 5 s), chaque POST échoué est abandonné
  silencieusement. Relève de **M05 (livraison fiable)** — non traité ici.
- **P6 — Rate limiter KV non atomique.** `ratelimit.ts` fait get puis put (best-effort acté,
  CLAUDE.md/README). **Non remplacé** en M04.

## Résultats M04 — avant / après

### Bundle panel

| Métrique | Avant | Après | Δ |
|---|---:|---:|---:|
| **JS initial (brut)** | 1 018 374 o | **382 613 o** | **−62 %** |
| **JS initial (gzip)** | 294 424 o | **119 577 o** | **−59 %** |
| Nombre de chunks JS | 1 | ~29 (par route + communs) | découpage |
| Chunk Recharts (Stats) | dans l'initial | **425 kB / 121.7 kB gzip, chargé à la nav** | isolé |

- Cible **< 180 kB gzip** : atteinte (119.6 kB, marge ~60 kB).
- Le chunk `modules-*.js` (@bot/shared, 86 kB / 22.5 kB gzip) est **asynchrone**
  (non préchargé dans `index.html`) : il ne pèse pas sur le chargement initial.
- Pas de sur-découpage : split par route + quelques chunks communs automatiques,
  aucun `manualChunks` manuel ajouté.

### Lectures D1 sur `/internal/config`

| | Avant | Après |
|---|---:|---:|
| Requêtes D1 | 9 | 9 |
| **Allers-retours (guilde existante)** | **~8 séquentiels** | **1 parallèle** |

Contrat de réponse identique (vérifié par les tests worker existants). Le cas 404
(guilde inconnue, rare) exécute désormais 9 lectures au lieu d'1 : compromis assumé.

### Appels Worker sur cache froid concurrent (gateway)

| Scénario | Avant | Après |
|---|---:|---:|
| 10 événements simultanés, même guilde, cache froid | **10 appels** `/internal/config` | **1 appel** (coalescence) |

`null` mis en cache 5 s (au lieu de 60 s) ; un échec n'est jamais mis en cache.

### Retries Discord REST

| Cas | Avant | Après |
|---|---|---|
| GET sur 429 | 1 retry (Retry-After ≤5 s) | retry borné (≤2), backoff exp. + jitter, Retry-After respecté (plafond 5 s) |
| GET sur 5xx | aucun retry | retry borné idempotent |
| GET sur erreur transport | aucun retry | retry borné idempotent |
| Mutation (POST/PATCH/PUT/DELETE) sur 429/5xx/erreur | 1 retry sur 429 | **aucun retry** (jamais rejouée) |

### Budget automatisé

`packages/panel/scripts/check-bundle-budget.mjs`, câblé dans `build` (donc dans
`deploy`). Mesure le JS initial (entrée + imports statiques de `index.html`),
échoue (exit 1) au-delà de **180 KiB gzip**. Override : `BUNDLE_BUDGET_GZIP_BYTES`.

- Build actuel : **116.8 kB gzip** (niveau 9) → ✓ sous budget, marge 63.2 kB.
- Dépassement simulé (budget 97.7 kB) → exit 1 (garde-fou vérifié).

## Préservation M01/M02/M03

M04 ne touche ni au schéma D1, ni aux contrats d'API, ni aux gates de modules :
l'instrumentation M01 (`operation_metrics`, heartbeat runtime), les contrôles M02
(HMAC interne, quotas, audit, CSP) et la gouvernance M03 (`guild_modules`, projection
gateway versionnée) restent inchangés. Les optimisations préservent les contrats
(réponse `/internal/config` identique, isolation `guildId`).
