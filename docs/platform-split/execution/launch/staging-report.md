# Rapport — Environnement de staging Archolabs

> Staging **déployé et validé**, entièrement isolé de la production. Aucune ressource de production touchée. Aucun secret dans Git. Aucune clé live, aucun paiement réel.

## Ressources créées (compte Cloudflare `20fe2e70…`)

| Ressource | Nom / ID | Rôle |
|-----------|----------|------|
| Worker | **botdiscord-staging** — `https://botdiscord-staging.archodev.workers.dev` (Version `51a3ef3c…`) | Socle staging |
| D1 | **botdiscord-staging** — `66794d5c-9302-4427-965c-19b937c6080a` | Base isolée (migrations 0001→0039) |
| KV | `356e7ad4a6654714a51b9fb8b823ac15` (binding `KV`) | Sessions, rate-limits, rollout, cache — **unifié** (le code n'a qu'un binding `KV`) |
| Pages | **botdiscord-studio-staging** — `https://botdiscord-studio-staging.pages.dev` | Front-end Studio (hébergement séparé) |

> **Production INCHANGÉE** : worker `botdiscord`, D1 `botdiscord` (`464ca130…`), KV `364e4736…` — jamais touchés. Le staging est un environnement Wrangler séparé (`env.staging`), déployé uniquement via `wrangler deploy --env staging`.

## Configuration (`wrangler.jsonc` → `env.staging`, branche `chore/staging-environment`)

- `name=botdiscord-staging`, `workers_dev=true`, **pas de cron** (la prod garde les siens).
- `PANEL_ORIGIN`/`PANEL_ALLOWED_ORIGINS = https://botdiscord-staging.archodev.workers.dev`, `APP_VERSION=staging`, `INTERNAL_AUTH_MODE=dual`.
- **Flags** : `PLATFORM_ENTITLEMENTS=true`, `PLATFORM_SUPPORT=true` (sans dépendance externe). **OFF** : `PLATFORM_BILLING`, `PLATFORM_STUDIO`, `PLATFORM_LAUNCH`, `LAUNCH_*`, `STUDIO_HOST`.
- **Aucun secret dans le dépôt.**

## 🔴 Bug de config trouvé et corrigé (déjà sur `master`, commit `f174701`)

`run_worker_first` ne listait pas `/webhooks/*`, `/studio-api/*`, `/studio/*`, `/status` → ces chemins tombaient dans le *SPA fallback* des assets (`index.html`) au lieu d'atteindre le Worker. **En prod, webhooks Stripe (M10) et Studio (M12–M15) auraient été cassés.** Corrigé, et **validé en live sur le staging** (voir smoke tests).

## ⚠️ Gotcha wrangler (documenté)

`wrangler kv key put/get` **par défaut = LOCAL** ; il faut **`--remote`** pour écrire dans le namespace lu par le Worker déployé. (Les commandes D1 utilisaient bien `--remote`.)

## Smoke tests — LIVE sur le staging (✅)

| Test | Résultat |
|------|----------|
| `GET /health` | `{"ok":true}` ✅ |
| `GET /status` | worker **up**, d1 **up**, kv **up**, gateway down (aucun gateway staging) ✅ |
| `GET /api/pricing` | `{"launch":false,"pricing":null}` ✅ (launch off) |
| `GET /api/updates` | liste vide ✅ (lecture publique) |
| `POST /webhooks/stripe` | **503 `webhook_not_configured` (JSON)** — atteint le Worker, pas le SPA ✅ (valide le correctif `run_worker_first`) |
| `GET /studio-api/session` (studio off) | **404 JSON** — pas le SPA ✅ (isolation + correctif) |
| `GET /api/subscription` (sans session) | 401 ✅ |
| `GET /api/subscription` (session forgée, entitlement business en D1) | **`business`** ✅ (entitlements résolus depuis la D1 staging) |
| `GET /api/account` (session) | identité renvoyée ✅ |
| `POST /api/support/tickets` (business) | ticket créé, **priorité `high`** ✅ |
| `GET /api/support/tickets` | liste le ticket ✅ |
| `GET /studio-api/overview` (studio off) | 404 ✅ (Studio dark) |

**Technique de test sans OAuth** : session forgée écrite dans le KV **remote** (`sess:<id>`) + entitlement inséré dans la D1 **remote** — mêmes techniques que la suite de tests, reproduisant le parcours **sans** la porte d'entrée Discord OAuth (hand-off). Réversible (`wrangler kv key delete` + `DELETE FROM entitlements`).

## Studio (préparé, non fonctionnel de bout en bout)

- SPA déployée sur Pages (`botdiscord-studio-staging.pages.dev`), **hébergement séparé** conforme au design M12.
- **Écart M12** : la SPA appelle `/studio-api/*` en same-origin ; sur `pages.dev`, il faut un **proxy** vers le Worker (ou servir la SPA sur un host que le Worker gère). Tant que ce n'est pas câblé + `platform.studio` on + `STUDIO_OWNER_IDS` + callbacks Discord studio, le Studio reste **dark** (404) — testé.

## Actions restantes (hand-off — voir le message de handoff)

1. **App Discord staging + callbacks** (auth client + studio).
2. **Clés Stripe TEST** (secret) → activer `platform.billing` + tester checkout.
3. **Webhook Stripe TEST** → tester l'idempotence `paid`.
4. **Studio** : proxy `/studio-api` + `STUDIO_OWNER_IDS` + `STUDIO_HOST` + `platform.studio=true`.

## Rollback / nettoyage

- Flags : redeploy `--env staging` sans les vars, ou rollout off.
- Ressources : `wrangler d1 delete botdiscord-staging`, `wrangler kv namespace delete --namespace-id 356e7ad4…`, supprimer le worker `botdiscord-staging` et le projet Pages. **Aucun impact prod.**
- Données de test : session forgée + entitlement business (user `900000000000000001`) supprimables.
