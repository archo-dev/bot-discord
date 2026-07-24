# Runbook go-live — Plateforme SaaS Archodev

> ⚠️ **Procédure documentée — NON exécutée en M16.** À dérouler uniquement après signature du [dossier d'autorisation](./authorization-dossier.md). Chaque étape est **additive et réversible**. Respecter les pièges `CLAUDE.md`.

## Pré-vol

- [ ] Décisions D1/D3/D12/D18/D20/D21/D17 tranchées ; brouillons juridiques **validés**.
- [ ] `master == origin/master`, working tree propre, `pnpm -r check` + tests verts.
- [ ] Preview locale validée (rollout, kill-switch, revert flag).

## Étape 1 — Migrations D1 (additif)

```powershell
$env:Path = "C:\Program Files\Git\cmd;$env:APPDATA\npm;$env:Path"
pnpm run migrate:remote   # applique 0032 → 0039 (jamais destructif)
```
Rollback : migrations additives → aucune suppression ; en cas de souci, ne pas « dé-migrer » (désactiver l'usage par flag).

## Étape 2 — Secrets prod (jamais en clair, jamais via `secret put` sous PowerShell)

```powershell
# Rédiger un fichier JSON temporaire (hors dépôt) puis :
wrangler secret bulk .\secrets.prod.json
Remove-Item .\secrets.prod.json -Force   # supprimer immédiatement
```
Secrets : `SESSION_SECRET`, `INTERNAL_API_TOKEN`, `DISCORD_*`, `STRIPE_SECRET_KEY` (**live**), `STRIPE_WEBHOOK_SECRET` (**live**), `STUDIO_SESSION_GLOBAL_VERSION`, `STUDIO_OWNER_IDS`. **Piège CRLF** : jamais `Write-Output "x" | wrangler secret put` (→ 401 Ed25519).

## Étape 3 — Variables de config (non secrètes)

`LAUNCH_CURRENCY`, `LAUNCH_PRICE_PREMIUM_MONTH/_YEAR`, `LAUNCH_PRICE_BUSINESS_MONTH/_YEAR`, `BILLING_PROVIDER`, `BILLING_PRICE_*`, `STUDIO_HOST`, `PANEL_ORIGIN`. Voir [config-templates.md](./config-templates.md).

## Étape 4 — Déploiement Worker + panel

```powershell
pnpm --filter @bot/worker run deploy   # TOUJOURS `run` (pnpm 10)
```
Rollback : re-deploy de la version précédente (Cloudflare garde l'historique).

## Étape 5 — Studio (host isolé `studio.archolabs.com`, modèle Pages + routes Worker)

Modèle retenu (**Option 1**, identique au staging) : la **SPA Studio est servie par un projet
Cloudflare Pages** (`botdiscord-studio-production`, custom domain `studio.archolabs.com`), et
**seuls deux préfixes d'API sont routés vers le Worker** `botdiscord` (les patterns de route
surclassent le custom domain Pages) :

- `studio.archolabs.com/studio-api/*` → Worker
- `studio.archolabs.com/studio/auth/*` → Worker

Ces deux routes sont déclarées dans `packages/worker/wrangler.jsonc` (bloc production). **Jamais**
de route `studio.archolabs.com/*` générique (sinon collision : le Worker attrape-tout servirait le
panel client sur `/`).

⚠️ **Prérequis bascule — détacher l'ancien Custom Domain Worker.** `studio.archolabs.com` était
rattaché comme **Custom Domain du Worker** `botdiscord` (attrape-tout) et servait donc le **panel
client** sur `/`. Avant d'attacher le host à Pages, il faut **détacher ce Custom Domain Worker**
(un hostname = un seul propriétaire). Séquence complète : voir `archolabs-cutover.md`.

- Définir `STUDIO_HOST=studio.archolabs.com` (déjà en prod) et poser le secret `STUDIO_OWNER_IDS`.
- **Activation** : le host-gating Studio (`studioEnabled`) dépend **uniquement** de la variable
  `PLATFORM_STUDIO` (env). Tant qu'elle est **absente/false**, toutes les routes `/studio-*`
  renvoient 404 (dark), **quel que soit** l'état d'un éventuel cohort rollout KV.
- Rollback : détacher le host de Pages + le réattacher au Custom Domain Worker (retour à l'état
  antérieur, `/` = panel client) ; retirer les deux routes ; `STUDIO_KILL_SWITCH=true` en
  coupe-circuit immédiat (503 sur le host studio, le host client reste 404).

## Étape 6 — Gateway (si mise à jour requise)

`git bundle` + scp vers le VPS OVH + `systemctl restart botdiscord-gateway` (recette `roadmap.md`). Aucun secret Discord modifié sans nécessité.

## Étape 7 — Activation progressive (M15 rollout par cohortes)

Pour les flags **guild-scopés** (`platform.entitlements`, `platform.billing`, `platform.support`,
enfin `platform.launch`) :
1. `PUT /studio-api/rollout/<flag>` avec 1–3 **guildes pilotes** (sans redeploy).
2. Smoke tests sur les pilotes.
3. Élargir la cohorte → général (flag global on) uniquement après validation.
Rollback : retirer la cohorte / flag global off (instantané).

> ⚠️ **`platform.studio` n'est PAS géré par le rollout par cohortes.** Le host-gating Studio
> (`studioEnabled`, `src/auth/studio-guard.ts`) lit **exclusivement** la variable d'env
> `PLATFORM_STUDIO` ; `resolveGuildFlag`/les cohortes KV (`src/config/rollout.ts`) sont
> **guild-scopés** et n'ont **aucun** effet sur l'activation du Studio. Un
> `PUT /studio-api/rollout/platform.studio` **n'active donc PAS** le Studio. Activation réelle =
> déclarer `PLATFORM_STUDIO=true` + redeploy (global). Tant que la variable est absente → 404
> partout (dark). En prod, `verify-worker-flags.mjs` attend `PLATFORM_STUDIO` **absent** : sa règle
> devra être mise à jour au moment de l'activation (hors dark launch).

## Étape 8 — Smoke tests prod (voir `12-testing-and-release-strategy.md` §9)

- `/status` vert ; login client + Studio (cookies séparés) ; `/api/subscription` ; `/updates` ; webhook test → `paid` idempotent ; `/api/pricing` affiche les prix ; **aucune** route studio sur le domaine client.

## Étape 9 — Lancement commercial

- `platform.launch` on **seulement** après prix (D1) + juridique validés.
- Vérifier un premier achat de bout en bout (d'abord sandbox, puis 1 achat live contrôlé).

## Rollback global

| Niveau | Moyen |
|--------|-------|
| Fonctionnel | Bascule de flag off / retrait de cohorte / `STUDIO_KILL_SWITCH` |
| Code | `git revert` du merge de milestone |
| Déploiement | Re-deploy version précédente |
| Données | Migrations additives → désactiver l'usage, jamais supprimer |
